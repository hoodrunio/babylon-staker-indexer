import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { CacheService } from '../CacheService';
import { 
    FinalityProvider, 
    FinalityProviderPower,
    QueryFinalityProvidersResponse,
    QueryFinalityProviderResponse,
    ActiveProviderResponse,
    FinalityProviderWithMeta
} from '../../types/finality/btcstaking';
import { formatSatoshis, calculatePowerPercentage } from '../../utils/util';
import { logger } from '../../utils/logger';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';

interface CacheEntry<T> {
    data: T;
    lastFetched: number;
}

export class FinalityProviderService {
    private static instance: FinalityProviderService | null = null;
    private babylonClient: BabylonClient;
    private cache: CacheService;
    private revalidationPromises: Map<string, Promise<any>> = new Map();
    
    // Cache TTL values (in seconds)
    private readonly CACHE_TTL = {
        PROVIDERS_LIST: 300, // 5 minutes
        PROVIDER_DETAILS: 300, // 5 minutes
        POWER: 300, // 5 minutes
        TOTAL_POWER: 300 // 5 minutes
    };

    private constructor() {
        this.babylonClient = BabylonClient.getInstance(Network.MAINNET);
        this.cache = CacheService.getInstance();
    }

    public static getInstance(): FinalityProviderService {
        if (!FinalityProviderService.instance) {
            FinalityProviderService.instance = new FinalityProviderService();
        }
        return FinalityProviderService.instance;
    }

    private getNetworkConfig(network: Network = Network.MAINNET) {
        const client = BabylonClient.getInstance(network);
        return {
            nodeUrl: client.getBaseUrl(),
            rpcUrl: client.getRpcUrl()
        };
    }

    private async getWithRevalidate<T>(
        cacheKey: string,
        ttl: number,
        fetchFn: () => Promise<T>
    ): Promise<T> {
        try {
            const cachedEntry = await this.cache.get<CacheEntry<T>>(cacheKey);

            if (this.revalidationPromises.has(cacheKey)) {
                if (cachedEntry) {
                    return cachedEntry.data;
                }
                return this.revalidationPromises.get(cacheKey)!;
            }

            const now = Date.now();

            if (cachedEntry && (now - cachedEntry.lastFetched) < ttl * 1000) {
                return cachedEntry.data;
            }

            if (cachedEntry) {
                this.revalidateInBackground(cacheKey, fetchFn, ttl);
                return cachedEntry.data;
            }

            const revalidationPromise = this.fetchAndCache(cacheKey, fetchFn, ttl);
            this.revalidationPromises.set(cacheKey, revalidationPromise);

            const data = await revalidationPromise;
            this.revalidationPromises.delete(cacheKey);
            return data;
        } catch (error) {
            this.revalidationPromises.delete(cacheKey);
            throw error;
        }
    }

    private async revalidateInBackground<T>(
        cacheKey: string,
        fetchFn: () => Promise<T>,
        ttl: number
    ): Promise<void> {
        if (this.revalidationPromises.has(cacheKey)) {
            return;
        }

        const revalidationPromise = this.fetchAndCache(cacheKey, fetchFn, ttl);
        this.revalidationPromises.set(cacheKey, revalidationPromise);

        try {
            await revalidationPromise;
        } catch (error) {
            logger.error(`Background revalidation failed for ${cacheKey}:`, error);
        } finally {
            this.revalidationPromises.delete(cacheKey);
        }
    }

    private async fetchAndCache<T>(
        cacheKey: string,
        fetchFn: () => Promise<T>,
        ttl: number
    ): Promise<T> {
        const data = await fetchFn();
        const entry: CacheEntry<T> = {
            data,
            lastFetched: Date.now()
        };
        await this.cache.set(cacheKey, entry, ttl);
        return data;
    }

    public async getActiveFinalityProviders(network: Network = Network.MAINNET): Promise<FinalityProvider[]> {
        const cacheKey = `fp:active:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.PROVIDERS_LIST,
            async () => {
                const { nodeUrl } = this.getNetworkConfig(network);
                
                // 1. First, get the latest block height
                const currentHeight = await this.babylonClient.getCurrentHeight();
                
                // 2. Get active FPs from the last block
                const activeResponse = await fetch(`${nodeUrl}/babylon/finality/v1/finality_providers/${currentHeight}`);
                if (!activeResponse.ok) {
                    throw new Error(`HTTP error! status: ${activeResponse.status}`);
                }
                
                const activeData = await activeResponse.json() as ActiveProviderResponse;
                
                // Get public keys of active FPs into a set
                const activePkSet = new Set(
                    activeData.finality_providers.map((fp: FinalityProviderWithMeta) => fp.btc_pk_hex)
                );
                
                // 3. Get detailed information of all FPs
                const allProviders: FinalityProvider[] = [];
                let nextKey = '';
                
                do {
                    const url = new URL(`${nodeUrl}/babylon/btcstaking/v1/finality_providers`);
                    if (nextKey) {
                        url.searchParams.append('pagination.key', nextKey);
                    }
                    
                    const response = await fetch(url.toString());
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    
                    const data = await response.json() as QueryFinalityProvidersResponse;
                    
                    // Filter only active FP details
                    const activeProviders = data.finality_providers?.filter(provider => 
                        activePkSet.has(provider.btc_pk)
                    ) || [];
                    
                    allProviders.push(...activeProviders);
                    
                    nextKey = data.pagination?.next_key || '';
                } while (nextKey);
                
                return allProviders;
            }
        );
    }

    public async getAllFinalityProviders(network: Network = Network.MAINNET): Promise<FinalityProvider[]> {
        const cacheKey = `fp:all:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.PROVIDERS_LIST,
            async () => {
                const allProviders: FinalityProvider[] = [];
                let nextKey = '';
                
                do {
                    const { nodeUrl } = this.getNetworkConfig(network);
                    const url = new URL(`${nodeUrl}/babylon/btcstaking/v1/finality_providers`);
                    
                    // Add pagination parameters if we have a next key
                    if (nextKey) {
                        url.searchParams.append('pagination.key', nextKey);
                    }
                    
                    const response = await fetch(url.toString());
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    
                    const data = await response.json() as QueryFinalityProvidersResponse;
                    
                    // Add providers from current page to our collection
                    if (data.finality_providers) {
                        allProviders.push(...data.finality_providers);
                    }
                    
                    // Get next key from pagination response
                    nextKey = data.pagination?.next_key || '';
                    
                } while (nextKey); // Continue while we have a next key
                
                return allProviders;
            }
        );
    }

    public async getFinalityProvider(fpBtcPkHex: string, network: Network = Network.MAINNET): Promise<FinalityProvider & { isActive: boolean }> {
        const cacheKey = `fp:details:${fpBtcPkHex}:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.PROVIDER_DETAILS,
            async () => {
                const [providerResponse, activeProviders] = await Promise.all([
                    fetch(`${this.getNetworkConfig(network).nodeUrl}/babylon/btcstaking/v1/finality_providers/${fpBtcPkHex}/finality_provider`),
                    this.getActiveFinalityProviders(network)
                ]);

                if (!providerResponse.ok) {
                    throw new Error(`HTTP error! status: ${providerResponse.status}`);
                }

                const data = await providerResponse.json() as QueryFinalityProviderResponse;
                
                return {
                    ...data.finality_provider,
                    isActive: activeProviders.some(p => p.btc_pk === fpBtcPkHex)
                };
            }
        );
    }

    public async getFinalityProviderPower(fpBtcPkHex: string, network: Network = Network.MAINNET): Promise<FinalityProviderPower> {
        const cacheKey = `fp:power:${fpBtcPkHex}:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.POWER,
            async () => {
                const [powerResponse, totalPower] = await Promise.all([
                    fetch(`${this.getNetworkConfig(network).nodeUrl}/babylon/finality/v1/finality_providers/${fpBtcPkHex}/power`),
                    this.getTotalVotingPower(network)
                ]);

                if (!powerResponse.ok) {
                    throw new Error(`HTTP error! status: ${powerResponse.status}`);
                }

                const data = await powerResponse.json() as { voting_power: string; height: number };
                const rawPower = data.voting_power || '0';
                
                const result = {
                    power: formatSatoshis(Number(rawPower)),
                    powerPercentage: calculatePowerPercentage(rawPower, totalPower.rawTotalPower),
                    height: data.height || 0,
                    totalNetworkPower: totalPower.totalPower
                };

                return result;
            }
        );
    }

    private async getTotalVotingPower(network: Network = Network.MAINNET): Promise<{ totalPower: string; rawTotalPower: string }> {
        const cacheKey = `fp:total-power:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.TOTAL_POWER,
            async () => {
                const currentHeight = await this.babylonClient.getCurrentHeight();
                const response = await fetch(`${this.getNetworkConfig(network).nodeUrl}/babylon/finality/v1/finality_providers/${currentHeight}`);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json() as { 
                    finality_providers: Array<{ 
                        btc_pk: string; 
                        voting_power: string;
                        jailed: boolean;
                    }> 
                };

                const totalPowerBigInt = data.finality_providers
                    .filter(fp => !fp.jailed)
                    .reduce((acc, fp) => acc + BigInt(fp.voting_power || '0'), BigInt(0));
                
                const result = {
                    totalPower: formatSatoshis(Number(totalPowerBigInt.toString())),
                    rawTotalPower: totalPowerBigInt.toString()
                };

                return result;
            }
        );
    }

    public async getFinalityProviderDelegationStats(fpBtcPkHex: string, network: Network = Network.MAINNET): Promise<{
        active_tvl: string;
        active_tvl_sat: number;
        total_tvl: string;
        total_tvl_sat: number;
        delegation_count: number;
    }> {
        const cacheKey = `fp:delegation-stats:${fpBtcPkHex}:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.PROVIDER_DETAILS,
            async () => {
                try {
                    const networkLower = network.toLowerCase();
                    
                    // Aggregate delegation stats for this provider
                    // Only include delegations that reference this finality provider
                    const result = await NewBTCDelegation.aggregate([
                        { 
                            $match: { 
                                networkType: networkLower,
                                finalityProviderBtcPksHex: fpBtcPkHex
                            }
                        },
                        {
                            $group: {
                                _id: "$state",
                                count: { $sum: 1 },
                                totalAmount: { $sum: "$totalSat" }
                            }
                        }
                    ]);
                    
                    // Initialize return values
                    let activeTvlSat = 0;
                    let totalTvlSat = 0;
                    let delegationCount = 0;
                    
                    // Process aggregation results
                    result.forEach((stat: { _id: string; count: number; totalAmount: number }) => {
                        delegationCount += stat.count;
                        totalTvlSat += stat.totalAmount;
                        
                        if (stat._id === 'ACTIVE') {
                            activeTvlSat = stat.totalAmount;
                        }
                    });
                    
                    return {
                        active_tvl: formatSatoshis(activeTvlSat),
                        active_tvl_sat: activeTvlSat,
                        total_tvl: formatSatoshis(totalTvlSat),
                        total_tvl_sat: totalTvlSat,
                        delegation_count: delegationCount
                    };
                } catch (error) {
                    logger.error(`Error getting delegation stats for provider ${fpBtcPkHex}:`, error);
                    return {
                        active_tvl: "0 BTC",
                        active_tvl_sat: 0,
                        total_tvl: "0 BTC",
                        total_tvl_sat: 0,
                        delegation_count: 0
                    };
                }
            }
        );
    }

    public async getAllFinalityProviderDelegationStats(network: Network = Network.MAINNET): Promise<Record<string, {
        active_tvl: string;
        active_tvl_sat: number;
        total_tvl: string;
        total_tvl_sat: number;
        delegation_count: number;
    }>> {
        const cacheKey = `fp:all-delegation-stats:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.PROVIDER_DETAILS,
            async () => {
                try {
                    const networkLower = network.toLowerCase();
                    
                    logger.info(`[FINALITY] Getting all delegation stats for network: ${networkLower}`);
                    
                    // Get delegation information for all finality providers with a single aggregation query
                    const result = await NewBTCDelegation.aggregate([
                        { 
                            // Filter delegations in a specific network
                            $match: { 
                                networkType: networkLower
                            }
                        },
                        // Expand the delegation to all finality providers within it
                        { 
                            $unwind: {
                                path: "$finalityProviderBtcPksHex",
                                preserveNullAndEmptyArrays: false
                            }
                        },
                        // Group by each finality provider and status combination
                        {
                            $group: {
                                _id: {
                                    fpBtcPkHex: "$finalityProviderBtcPksHex",
                                    state: "$state"
                                },
                                count: { $sum: 1 },
                                totalAmount: { $sum: "$totalSat" }
                            }
                        },
                        // Group the results by finality provider
                        {
                            $group: {
                                _id: "$_id.fpBtcPkHex",
                                states: { 
                                    $push: { 
                                        state: "$_id.state", 
                                        count: "$count", 
                                        totalAmount: "$totalAmount" 
                                    } 
                                },
                                totalCount: { $sum: "$count" },
                                totalAmount: { $sum: "$totalAmount" }
                            }
                        }
                    ]);
                    
                    logger.info(`[FINALITY] Query result for delegation stats: ${result.length} providers found`);
                    
                    // Process the results and return them as an object
                    const statsObj: Record<string, {
                        active_tvl: string;
                        active_tvl_sat: number;
                        total_tvl: string;
                        total_tvl_sat: number;
                        delegation_count: number;
                    }> = {};
                    
                    if (result.length === 0) {
                        logger.warn(`[FINALITY] No delegation stats found for network: ${networkLower}`);
                    }
                    
                    result.forEach((fpStats: { 
                        _id: string; 
                        states: Array<{ state: string; count: number; totalAmount: number }>;
                        totalCount: number;
                        totalAmount: number;
                    }) => {
                        const fpBtcPkHex = fpStats._id;
                        let activeTvlSat = 0;
                        
                        // Find delegations in the Active state - here we use a string value instead of an enum
                        // We are looking for the string value 'ACTIVE' stored in the NewBTCDelegation schema
                        const activeState = fpStats.states.find(s => s.state === 'ACTIVE');
                        if (activeState) {
                            activeTvlSat = activeState.totalAmount;
                        }
                        
                        // Save the stats
                        statsObj[fpBtcPkHex] = {
                            active_tvl: formatSatoshis(activeTvlSat),
                            active_tvl_sat: activeTvlSat,
                            total_tvl: formatSatoshis(fpStats.totalAmount),
                            total_tvl_sat: fpStats.totalAmount,
                            delegation_count: fpStats.totalCount
                        };
                    });
                    
                    const providerCount = Object.keys(statsObj).length;
                    logger.info(`[FINALITY] Processed ${providerCount} finality providers with delegations`);
                    
                    // Check for zero values - for debugging purposes
                    const zeroValueProviders = Object.entries(statsObj).filter(([_, stats]) => stats.total_tvl_sat === 0).length;
                    if (zeroValueProviders > 0) {
                        logger.warn(`[FINALITY] Found ${zeroValueProviders} providers with zero TVL - potential issue with data`);
                    }
                    
                    return statsObj;
                } catch (error) {
                    logger.error(`Error getting all delegation stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    logger.error(`Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
                    return {};
                }
            }
        );
    }
} 