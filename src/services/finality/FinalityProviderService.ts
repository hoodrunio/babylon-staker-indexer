import { Network } from '../../api/middleware/network-selector';
import { BabylonClient } from '../../clients/BabylonClient';
import { CacheService } from '../CacheService';
import { 
    FinalityProvider, 
    FinalityProviderPower,
    QueryFinalityProvidersResponse,
    QueryFinalityProviderResponse,
    QueryFinalityProviderDelegationsResponse,
    DelegationResponse
} from '../../types/finality/btcstaking';
import { formatSatoshis, calculatePowerPercentage } from '../../utils/util';
import { getTxHash } from '../../utils/generate-tx-hash';

interface CacheEntry<T> {
    data: T;
    lastFetched: number;
}

export class FinalityProviderService {
    private static instance: FinalityProviderService | null = null;
    private babylonClient: BabylonClient;
    private cache: CacheService;
    private revalidationPromises: Map<string, Promise<any>> = new Map();
    
    // Cache TTL değerleri (saniye cinsinden)
    private readonly CACHE_TTL = {
        PROVIDERS_LIST: 60, // 1 dakika
        PROVIDER_DETAILS: 300, // 5 dakika
        DELEGATIONS: 600, // 10 dakika
        POWER: 300, // 30 saniye
        TOTAL_POWER: 300 // 30 saniye
    };

    private constructor() {
        if (!process.env.BABYLON_NODE_URL || !process.env.BABYLON_RPC_URL) {
            throw new Error('BABYLON_NODE_URL and BABYLON_RPC_URL environment variables must be set');
        }
        this.babylonClient = BabylonClient.getInstance(
            process.env.BABYLON_NODE_URL,
            process.env.BABYLON_RPC_URL
        );
        this.cache = CacheService.getInstance();
    }

    public static getInstance(): FinalityProviderService {
        if (!FinalityProviderService.instance) {
            FinalityProviderService.instance = new FinalityProviderService();
        }
        return FinalityProviderService.instance;
    }

    private getNetworkConfig(network: Network = Network.MAINNET) {
        return {
            nodeUrl: network === Network.MAINNET ? process.env.BABYLON_NODE_URL : process.env.BABYLON_TESTNET_NODE_URL,
            rpcUrl: network === Network.MAINNET ? process.env.BABYLON_RPC_URL : process.env.BABYLON_TESTNET_RPC_URL
        };
    }

    private async getWithRevalidate<T>(
        cacheKey: string,
        ttl: number,
        fetchFn: () => Promise<T>
    ): Promise<T> {
        try {
            // Cache'den veriyi al
            const cachedEntry = await this.cache.get<CacheEntry<T>>(cacheKey);

            // Revalidation işlemi zaten devam ediyorsa, yeni bir istek başlatma
            if (this.revalidationPromises.has(cacheKey)) {
                if (cachedEntry) {
                    return cachedEntry.data;
                }
                // Cache yoksa, devam eden revalidation'ı bekle
                return this.revalidationPromises.get(cacheKey)!;
            }

            const now = Date.now();

            // Cache var ve TTL dolmamışsa direkt dön
            if (cachedEntry && (now - cachedEntry.lastFetched) < ttl * 1000) {
                return cachedEntry.data;
            }

            // Cache var ama TTL dolmuşsa, eski veriyi dön ve arka planda güncelle
            if (cachedEntry) {
                this.revalidateInBackground(cacheKey, fetchFn, ttl);
                return cachedEntry.data;
            }

            // Cache yoksa, yeni veriyi getir
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
            console.error(`Background revalidation failed for ${cacheKey}:`, error);
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
                const response = await fetch(`${nodeUrl}/babylon/btcstaking/v1/finality_providers`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json() as QueryFinalityProvidersResponse;
                
                return data.finality_providers?.filter(provider => {
                    if (provider.highest_voted_height === 0) {
                        return false;
                    }
                    if (provider.jailed) {
                        return false;
                    }
                    return true;
                }) || [];
            }
        );
    }

    public async getAllFinalityProviders(network: Network = Network.MAINNET): Promise<FinalityProvider[]> {
        const cacheKey = `fp:all:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.PROVIDERS_LIST,
            async () => {
                const { nodeUrl } = this.getNetworkConfig(network);
                const response = await fetch(`${nodeUrl}/babylon/btcstaking/v1/finality_providers`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json() as QueryFinalityProvidersResponse;
                
                return data.finality_providers || [];
            }
        );
    }

    public async getFinalityProvider(fpBtcPkHex: string, network: Network = Network.MAINNET): Promise<FinalityProvider> {
        const cacheKey = `fp:details:${fpBtcPkHex}:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.PROVIDER_DETAILS,
            async () => {
                const { nodeUrl } = this.getNetworkConfig(network);
                const response = await fetch(`${nodeUrl}/babylon/btcstaking/v1/finality_providers/${fpBtcPkHex}/finality_provider`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json() as QueryFinalityProviderResponse;
                
                return data.finality_provider;
            }
        );
    }

    public async getFinalityProviderDelegations(
        fpBtcPkHex: string, 
        network: Network = Network.MAINNET,
        page: number = 1,
        limit: number = 10
    ): Promise<{
        delegations: DelegationResponse[];
        pagination: {
            total_count: number;
            total_pages: number;
            current_page: number;
            has_next: boolean;
            has_previous: boolean;
            next_page: number | null;
            previous_page: number | null;
        };
        total_amount: string;
        total_amount_sat: number;
    }> {
        const { nodeUrl } = this.getNetworkConfig(network);
        const cacheKey = `fp:delegations:${fpBtcPkHex}`;

        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.DELEGATIONS,
            async () => {
                // If not in cache, fetch all delegations
                let allDelegations: DelegationResponse[] = [];
                let nextKey: string | null = null;

                do {
                    // Construct URL with pagination parameters
                    const url = new URL(`${nodeUrl}/babylon/btcstaking/v1/finality_providers/${fpBtcPkHex}/delegations`);
                    
                    // Add pagination parameters
                    url.searchParams.append('pagination.limit', '100'); // Fetch maximum allowed per request
                    if (nextKey) {
                        url.searchParams.append('pagination.key', nextKey);
                    }

                    const response = await fetch(url.toString());
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const data = await response.json() as QueryFinalityProviderDelegationsResponse;
                    
                    // Process current page delegations
                    const pageDelegations = data.btc_delegator_delegations?.map(delegation => {
                        if (!delegation || !delegation.dels || delegation.dels.length === 0) {
                            return null;
                        }

                        const del = delegation.dels[0];
                        const totalSat = Number(del.total_sat);
                        if (isNaN(totalSat)) {
                            console.warn(`Invalid total_sat value for delegation:`, del);
                            return null;
                        }

                        const delegationResponse: DelegationResponse = {
                            staker_address: del.staker_addr || '',
                            status: del.status_desc || '',
                            btc_pk_hex: del.btc_pk || '',
                            amount: formatSatoshis(totalSat),
                            amount_sat: totalSat,
                            start_height: Number(del.start_height) || 0,
                            end_height: Number(del.end_height) || 0,
                            duration: Number(del.staking_time) || 0,
                            transaction_id_hex: getTxHash(del.staking_tx_hex || '', false),
                            transaction_id: del.staking_tx_hex || ''
                        };

                        return delegationResponse;
                    }).filter((d): d is DelegationResponse => d !== null && d.amount_sat > 0) || [];

                    // Add current page delegations to all delegations
                    allDelegations = [...allDelegations, ...pageDelegations];

                    // Get next page key from pagination response
                    nextKey = data.pagination?.next_key || null;

                    // Log progress
                    console.log(`Fetched ${pageDelegations.length} delegations, total so far: ${allDelegations.length}`);

                } while (nextKey); // Continue until no more pages

                console.log(`Finished fetching all delegations. Total count: ${allDelegations.length}`);

                // Calculate pagination info
                const totalCount = allDelegations.length;
                const totalPages = Math.ceil(totalCount / limit);
                const currentPage = Math.min(Math.max(1, page), totalPages);
                const startIndex = (currentPage - 1) * limit;
                const endIndex = startIndex + limit;

                // Calculate total amount from all delegations
                const totalAmountSat = allDelegations.reduce((sum, d) => sum + d.amount_sat, 0);

                // Return paginated result with pagination info and total amounts
                return {
                    delegations: allDelegations.slice(startIndex, endIndex),
                    pagination: {
                        total_count: totalCount,
                        total_pages: totalPages,
                        current_page: currentPage,
                        has_next: currentPage < totalPages,
                        has_previous: currentPage > 1,
                        next_page: currentPage < totalPages ? currentPage + 1 : null,
                        previous_page: currentPage > 1 ? currentPage - 1 : null
                    },
                    total_amount: formatSatoshis(totalAmountSat),
                    total_amount_sat: totalAmountSat
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
                // Provider'ın power'ını ve toplam power'ı paralel olarak al
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
} 