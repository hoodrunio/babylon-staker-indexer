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
        this.babylonClient = BabylonClient.getInstance();
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
                
                // 1. Önce son blok yüksekliğini al
                const currentHeight = await this.babylonClient.getCurrentHeight();
                
                // 2. Son bloktaki aktif FP'leri al
                const activeResponse = await fetch(`${nodeUrl}/babylon/finality/v1/finality_providers/${currentHeight}`);
                if (!activeResponse.ok) {
                    throw new Error(`HTTP error! status: ${activeResponse.status}`);
                }
                
                const activeData = await activeResponse.json() as ActiveProviderResponse;
                
                // Aktif FP'lerin public key'lerini set'e al
                const activePkSet = new Set(
                    activeData.finality_providers.map((fp: FinalityProviderWithMeta) => fp.btc_pk_hex)
                );
                
                // 3. Tüm FP'lerin detaylı bilgilerini al
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
                    
                    // Sadece aktif FP'lerin detaylarını filtrele
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
} 