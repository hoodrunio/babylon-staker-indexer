import { IPriceProvider } from './TokenRepository';
import { logger } from '../../../../utils/logger';
import axios, { AxiosInstance, AxiosError } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * CoinGecko Price Provider Implementation
 * Adapts CoinGecko API to IPriceProvider interface
 */
export class CoinGeckoPriceProvider implements IPriceProvider {
    public readonly name = 'CoinGecko';
    
    private readonly axiosInstance: AxiosInstance;
    private readonly priceCache = new Map<string, { price: number; timestamp: Date; ttl: number }>();
    private lastRequestTime = 0;
    
    private readonly config = {
        coingeckoApiKey: process.env.COINGECKO_API_KEY,
        cacheTtlMinutes: 5,
        maxRetries: 3,
        retryDelayMs: 1000,
        batchSize: 250,
        rateLimitPerMinute: this.detectApiTier() ? 100 : (process.env.COINGECKO_API_KEY ? 50 : 10),
        isProApi: this.detectApiTier()
    };

    // Stablecoin mappings for fallback prices
    private readonly stablecoins = new Set([
        'usd-coin', 'tether', 'dai', 'frax', 'trueusd', 'paxos-standard', 'axl-usdc', 'usdc'
    ]);

    constructor() {
        this.axiosInstance = axios.create({
            baseURL: this.config.isProApi 
                ? 'https://pro-api.coingecko.com/api/v3'
                : 'https://api.coingecko.com/api/v3',
            timeout: 10000,
            headers: this.getApiHeaders()
        });

        this.setupAxiosInterceptors();
        this.startPriceRefreshInterval();
    }

    async getPrice(coingeckoId: string): Promise<number> {
        // Check cache first
        const cachedPrice = this.getCachedPrice(coingeckoId);
        if (cachedPrice !== null) {
            return cachedPrice;
        }

        // Stablecoin fallback
        if (this.stablecoins.has(coingeckoId)) {
            const fallbackPrice = 1.0;
            this.cachePrice(coingeckoId, fallbackPrice);
            return fallbackPrice;
        }

        try {
            await this.respectRateLimit();
            
            const response = await this.axiosInstance.get('/simple/price', {
                params: {
                    ids: coingeckoId,
                    vs_currencies: 'usd',
                    include_last_updated_at: true
                }
            });

            const priceData = response.data[coingeckoId];
            if (!priceData || typeof priceData.usd !== 'number') {
                throw new Error(`No price data for ${coingeckoId}`);
            }

            const price = priceData.usd;
            this.cachePrice(coingeckoId, price);
            
            logger.debug(`[CoinGeckoPriceProvider] Fetched price for ${coingeckoId}: $${price}`);
            return price;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const statusCode = (error as any)?.response?.status;
            
            logger.warn(`[CoinGeckoPriceProvider] Failed to fetch price for ${coingeckoId} (status: ${statusCode}): ${errorMessage}`);
            
            // Return stablecoin fallback for known stables
            if (this.stablecoins.has(coingeckoId)) {
                this.cachePrice(coingeckoId, 1.0);
                return 1.0;
            }
            
            // For 400 errors, the coingeckoId might be invalid
            if (statusCode === 400) {
                logger.info(`[CoinGeckoPriceProvider] CoinGecko ID '${coingeckoId}' appears to be invalid, caching 0 price`);
                this.cachePrice(coingeckoId, 0);
            }
            
            return 0;
        }
    }

    async getPrices(coingeckoIds: string[]): Promise<Map<string, number>> {
        const result = new Map<string, number>();
        const idsToFetch: string[] = [];

        // Check cache for each ID
        for (const id of coingeckoIds) {
            const cachedPrice = this.getCachedPrice(id);
            if (cachedPrice !== null) {
                result.set(id, cachedPrice);
            } else if (this.stablecoins.has(id)) {
                // Use fallback for stablecoins
                result.set(id, 1.0);
                this.cachePrice(id, 1.0);
            } else {
                idsToFetch.push(id);
            }
        }

        if (idsToFetch.length === 0) {
            return result;
        }

        // Batch fetch remaining prices
        const batches = this.createBatches(idsToFetch, this.config.batchSize);
        
        for (const batch of batches) {
            try {
                await this.respectRateLimit();
                
                const response = await this.axiosInstance.get('/simple/price', {
                    params: {
                        ids: batch.join(','),
                        vs_currencies: 'usd',
                        include_last_updated_at: true
                    }
                });

                for (const [coinId, priceData] of Object.entries(response.data)) {
                    if (priceData && typeof (priceData as any).usd === 'number') {
                        const price = (priceData as any).usd;
                        result.set(coinId, price);
                        this.cachePrice(coinId, price);
                    }
                }

            } catch (error) {
                logger.error(`[CoinGeckoPriceProvider] Batch fetch failed for ${batch.length} tokens:`, error);
                
                // Set 0 for failed tokens (except stablecoins)
                for (const id of batch) {
                    if (!result.has(id)) {
                        result.set(id, this.stablecoins.has(id) ? 1.0 : 0);
                    }
                }
            }
        }

        logger.info(`[CoinGeckoPriceProvider] Fetched prices for ${result.size}/${coingeckoIds.length} tokens`);
        return result;
    }

    supports(coingeckoId: string): boolean {
        // CoinGecko supports most tokens, but we can add specific exclusions here
        return coingeckoId.length > 0 && !coingeckoId.includes('unknown');
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: number;
        stableTokensCount: number;
        nonStableTokensCount: number;
        entries: Array<{ key: string; price: number; age: number; isStable?: boolean }>;
    } {
        const entries = Array.from(this.priceCache.entries()).map(([key, value]) => ({
            key,
            price: value.price,
            age: Date.now() - value.timestamp.getTime(),
            isStable: this.stablecoins.has(key)
        }));

        return {
            size: this.priceCache.size,
            stableTokensCount: entries.filter(e => e.isStable).length,
            nonStableTokensCount: entries.filter(e => !e.isStable).length,
            entries
        };
    }

    /**
     * Clear price cache
     */
    clearCache(): void {
        this.priceCache.clear();
        logger.info('[CoinGeckoPriceProvider] Cache cleared');
    }

    private getCachedPrice(cacheKey: string): number | null {
        const cached = this.priceCache.get(cacheKey);
        if (!cached) return null;

        const ageMs = Date.now() - cached.timestamp.getTime();
        if (ageMs > cached.ttl) {
            this.priceCache.delete(cacheKey);
            return null;
        }

        return cached.price;
    }

    private cachePrice(coingeckoId: string, price: number): void {
        this.priceCache.set(coingeckoId, {
            price,
            timestamp: new Date(),
            ttl: this.config.cacheTtlMinutes * 60 * 1000
        });
    }

    private async respectRateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const minInterval = (60 * 1000) / this.config.rateLimitPerMinute;

        if (timeSinceLastRequest < minInterval) {
            const waitTime = minInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequestTime = Date.now();
    }

    private createBatches<T>(array: T[], batchSize: number): T[][] {
        const batches: T[][] = [];
        for (let i = 0; i < array.length; i += batchSize) {
            batches.push(array.slice(i, i + batchSize));
        }
        return batches;
    }

    private startPriceRefreshInterval(): void {
        const intervalMs = (this.config.cacheTtlMinutes / 2) * 60 * 1000; // Refresh at half TTL
        
        setInterval(() => {
            const staleCount = Array.from(this.priceCache.values())
                .filter(cached => {
                    const ageMs = Date.now() - cached.timestamp.getTime();
                    return ageMs > (cached.ttl * 0.8); // Refresh when 80% of TTL is reached
                }).length;

            if (staleCount > 0) {
                logger.debug(`[CoinGeckoPriceProvider] ${staleCount} prices approaching expiration`);
            }
        }, intervalMs);
    }

    private getApiHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'User-Agent': 'Babylon-Staker-Indexer/1.0',
            'Accept': 'application/json'
        };

        if (this.config.coingeckoApiKey) {
            // Use appropriate header based on COINGECKO_API_TIER environment variable
            const headerName = this.config.isProApi ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key';
            headers[headerName] = this.config.coingeckoApiKey;
            
            logger.info(`[CoinGeckoPriceProvider] Using ${this.config.isProApi ? 'Pro' : 'Demo'} API with ${headerName}`);
        }

        return headers;
    }

    private detectApiTier(): boolean {
        return process.env.COINGECKO_API_TIER === 'pro';
    }

    private setupAxiosInterceptors(): void {
        this.axiosInstance.interceptors.response.use(
            response => response,
            async (error: AxiosError) => {
                if (error.response?.status === 429) {
                    logger.warn('[CoinGeckoPriceProvider] Rate limit exceeded, backing off');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    return Promise.reject(error);
                }
                
                if (error.response?.status === 403) {
                    logger.error('[CoinGeckoPriceProvider] API access forbidden - check API key');
                }
                
                return Promise.reject(error);
            }
        );
    }
} 