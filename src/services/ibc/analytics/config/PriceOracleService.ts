import { logger } from '../../../../utils/logger';
import axios, { AxiosInstance, AxiosError } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Token information interface
 */
export interface TokenInfo {
    symbol: string;
    decimals: number;
    priceUsd: number;
    lastUpdated: Date;
    coingeckoId?: string;
    isStable?: boolean; // Flag for stablecoins
}

/**
 * Price cache entry interface
 */
interface PriceCacheEntry {
    price: number;
    timestamp: Date;
    ttl: number; // Time to live in milliseconds
}

/**
 * CoinGecko API response interface
 */
interface CoinGeckoPrice {
    [coinId: string]: {
        usd: number;
        last_updated_at: number;
    };
}

/**
 * Price Oracle Configuration
 */
interface PriceOracleConfig {
    coingeckoApiKey?: string;
    cacheTtlMinutes: number;
    maxRetries: number;
    retryDelayMs: number;
    batchSize: number;
    rateLimitPerMinute: number;
    isProApi?: boolean; // Flag to determine API tier
}

/**
 * Production-Ready Price Oracle Service
 * Uses CoinGecko API with proper caching and rate limiting
 */
export class PriceOracleService {
    private static instance: PriceOracleService | null = null;
    private readonly axiosInstance: AxiosInstance;
    private readonly priceCache = new Map<string, PriceCacheEntry>();
    private readonly requestQueue: string[] = [];
    private isProcessingQueue = false;
    private lastRequestTime = 0;
    
    // Configuration
    private readonly config: PriceOracleConfig = {
        coingeckoApiKey: process.env.COINGECKO_API_KEY,
        cacheTtlMinutes: 5, // 5 minutes cache
        maxRetries: 3,
        retryDelayMs: 1000,
        batchSize: 250, // CoinGecko allows up to 250 coins per request
        rateLimitPerMinute: process.env.COINGECKO_API_KEY ? 100 : 30, // Higher rate for API key users
        isProApi: this.detectApiTier(process.env.COINGECKO_API_KEY)
    };

    // Token registry mapping denominations to CoinGecko IDs
    private readonly tokenRegistry: Record<string, TokenInfo> = {
        // Babylon tokens
        'ubbn': {
            symbol: 'BABY',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'babylon'
        },
        
        // Major Cosmos ecosystem tokens
        'uatom': {
            symbol: 'ATOM',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'cosmos'
        },
        'uosmo': {
            symbol: 'OSMO',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'osmosis'
        },
        'uaxl': {
            symbol: 'AXL',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'axelar'
        },
        'ustars': {
            symbol: 'STARS',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'stargaze'
        },
        'ujuno': {
            symbol: 'JUNO',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'juno-network'
        },
        'uakt': {
            symbol: 'AKT',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'akash-network'
        },
        'uregen': {
            symbol: 'REGEN',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'regen'
        },
        'uscrt': {
            symbol: 'SCRT',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'secret'
        },
        'uhuahua': {
            symbol: 'HUAHUA',
            decimals: 6,
            priceUsd: 0,
            lastUpdated: new Date(0),
            coingeckoId: 'chihuahua-token'
        },
        
        // Stablecoins - no API calls needed
        'uusdc': {
            symbol: 'USDC',
            decimals: 6,
            priceUsd: 1.00,
            lastUpdated: new Date(),
            coingeckoId: 'usd-coin',
            isStable: true
        },
        'uusdt': {
            symbol: 'USDT',
            decimals: 6,
            priceUsd: 1.00,
            lastUpdated: new Date(),
            coingeckoId: 'tether',
            isStable: true
        },
        'ausdc': {
            symbol: 'axlUSDC',
            decimals: 6,
            priceUsd: 1.00,
            lastUpdated: new Date(),
            isStable: true
        },
        'ausdt': {
            symbol: 'axlUSDT',
            decimals: 6,
            priceUsd: 1.00,
            lastUpdated: new Date(),
            isStable: true
        }
    };

    private constructor() {
        // Determine correct headers based on API key
        const apiHeaders = this.getApiHeaders();
        
        this.axiosInstance = axios.create({
            baseURL: 'https://api.coingecko.com/api/v3',
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
                ...apiHeaders
            }
        });

        // Setup response interceptor for error handling
        this.axiosInstance.interceptors.response.use(
            response => response,
            (error: AxiosError) => {
                logger.error(`[PriceOracleService] API Error: ${error.message}`, {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    url: error.config?.url,
                    headers: error.config?.headers
                });
                return Promise.reject(error);
            }
        );

        // Start price refresh interval
        this.startPriceRefreshInterval();
    }

    public static getInstance(): PriceOracleService {
        if (!PriceOracleService.instance) {
            PriceOracleService.instance = new PriceOracleService();
        }
        return PriceOracleService.instance;
    }

    /**
     * Convert token amount to USD value
     */
    public async convertToUsd(denom: string, amount: number): Promise<number> {
        const tokenInfo = this.getTokenInfo(denom);
        
        if (!tokenInfo) {
            logger.warn(`[PriceOracleService] Unknown denomination: ${denom}, returning 0 USD value`);
            return 0;
        }

        // Get fresh price if needed
        const price = await this.getTokenPrice(denom);
        
        if (price === 0) {
            logger.warn(`[PriceOracleService] No price available for ${denom}`);
            return 0;
        }

        // Convert micro-units to main units and calculate USD value
        const mainUnitAmount = amount / Math.pow(10, tokenInfo.decimals);
        const usdValue = mainUnitAmount * price;
        
        return usdValue;
    }

    /**
     * Get token price with caching (optimized for stablecoins)
     */
    public async getTokenPrice(denom: string): Promise<number> {
        const tokenInfo = this.tokenRegistry[denom];
        if (!tokenInfo) {
            return 0;
        }

        // For stablecoins, return fixed price immediately
        if (tokenInfo.isStable) {
            this.cacheStablePrice(denom, tokenInfo.priceUsd);
            return tokenInfo.priceUsd;
        }

        // Check cache first for non-stable tokens
        const cacheKey = tokenInfo.coingeckoId || denom;
        const cachedPrice = this.getCachedPrice(cacheKey);
        
        if (cachedPrice !== null) {
            return cachedPrice;
        }

        // Add to queue for batch fetching
        if (tokenInfo.coingeckoId && !this.requestQueue.includes(tokenInfo.coingeckoId)) {
            this.requestQueue.push(tokenInfo.coingeckoId);
        }

        // Process queue if not already processing
        if (!this.isProcessingQueue) {
            this.processRequestQueue();
        }

        // Return cached/fallback price while waiting for fresh data
        return tokenInfo.priceUsd || 0;
    }

    /**
     * Get multiple token prices efficiently (excludes stables from API calls)
     */
    public async getMultipleTokenPrices(denoms: string[]): Promise<Record<string, number>> {
        const result: Record<string, number> = {};
        const toFetch: string[] = [];

        // Process each token
        for (const denom of denoms) {
            const tokenInfo = this.tokenRegistry[denom];
            if (!tokenInfo) {
                result[denom] = 0;
                continue;
            }

            // Handle stablecoins immediately
            if (tokenInfo.isStable) {
                result[denom] = tokenInfo.priceUsd;
                this.cacheStablePrice(denom, tokenInfo.priceUsd);
                continue;
            }

            // Check cache for non-stable tokens
            const cacheKey = tokenInfo.coingeckoId || denom;
            const cachedPrice = this.getCachedPrice(cacheKey);
            
            if (cachedPrice !== null) {
                result[denom] = cachedPrice;
            } else if (tokenInfo.coingeckoId) {
                toFetch.push(tokenInfo.coingeckoId);
                result[denom] = tokenInfo.priceUsd || 0; // Fallback
            }
        }

        // Batch fetch missing non-stable prices
        if (toFetch.length > 0) {
            try {
                await this.fetchPricesFromAPI(toFetch);
                
                // Update results with fresh prices
                for (const denom of denoms) {
                    const tokenInfo = this.tokenRegistry[denom];
                    if (tokenInfo?.coingeckoId && !tokenInfo.isStable) {
                        const freshPrice = this.getCachedPrice(tokenInfo.coingeckoId);
                        if (freshPrice !== null) {
                            result[denom] = freshPrice;
                        }
                    }
                }
            } catch (error) {
                logger.error('[PriceOracleService] Failed to fetch prices for batch', error);
            }
        }

        return result;
    }

    /**
     * Get token information
     */
    public getTokenInfo(denom: string): TokenInfo | null {
        return this.tokenRegistry[denom] || null;
    }

    /**
     * Register a new token
     */
    public registerToken(denom: string, tokenInfo: TokenInfo): void {
        this.tokenRegistry[denom] = {
            ...tokenInfo,
            lastUpdated: new Date()
        };
        logger.info(`[PriceOracleService] Registered token: ${denom} (${tokenInfo.symbol})`);
    }

    /**
     * Get formatted token display info
     */
    public async getTokenDisplayInfo(denom: string, amount: number): Promise<{
        symbol: string;
        formattedAmount: string;
        usdValue: number;
        formattedUsdValue: string;
    }> {
        const tokenInfo = this.getTokenInfo(denom);
        
        if (!tokenInfo) {
            return {
                symbol: denom.toUpperCase(),
                formattedAmount: amount.toString(),
                usdValue: 0,
                formattedUsdValue: '$0.00'
            };
        }

        const mainUnitAmount = amount / Math.pow(10, tokenInfo.decimals);
        const usdValue = await this.convertToUsd(denom, amount);

        return {
            symbol: tokenInfo.symbol,
            formattedAmount: this.formatTokenAmount(mainUnitAmount),
            usdValue,
            formattedUsdValue: this.formatUsdAmount(usdValue)
        };
    }

    /**
     * Check cache for price
     */
    private getCachedPrice(cacheKey: string): number | null {
        const cached = this.priceCache.get(cacheKey);
        if (!cached) return null;

        const now = Date.now();
        if (now - cached.timestamp.getTime() > cached.ttl) {
            this.priceCache.delete(cacheKey);
            return null;
        }

        return cached.price;
    }

    /**
     * Process the request queue with rate limiting
     */
    private async processRequestQueue(): Promise<void> {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        try {
            while (this.requestQueue.length > 0) {
                // Respect rate limiting
                await this.respectRateLimit();

                // Take batch from queue
                const batch = this.requestQueue.splice(0, this.config.batchSize);
                
                try {
                    await this.fetchPricesFromAPI(batch);
                } catch (error) {
                    logger.error('[PriceOracleService] Failed to fetch price batch', error);
                    // Re-queue failed items for retry (with limit)
                    // Implementation depends on retry strategy
                }
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    /**
     * Fetch prices from CoinGecko API
     */
    private async fetchPricesFromAPI(coinIds: string[]): Promise<void> {
        if (coinIds.length === 0) return;

        let retries = 0;
        while (retries < this.config.maxRetries) {
            try {
                const response = await this.axiosInstance.get<CoinGeckoPrice>('/simple/price', {
                    params: {
                        ids: coinIds.join(','),
                        vs_currencies: 'usd',
                        include_last_updated_at: true
                    }
                });

                // Cache the prices
                const now = new Date();
                const ttl = this.config.cacheTtlMinutes * 60 * 1000;

                for (const [coinId, priceData] of Object.entries(response.data)) {
                    this.priceCache.set(coinId, {
                        price: priceData.usd,
                        timestamp: now,
                        ttl
                    });

                    // Update token registry
                    this.updateTokenRegistryPrice(coinId, priceData.usd);
                }

                logger.debug(`[PriceOracleService] Fetched prices for ${coinIds.length} tokens`);
                return; // Success

            } catch (error) {
                retries++;
                if (retries >= this.config.maxRetries) {
                    throw error;
                }

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs * retries));
            }
        }
    }

    /**
     * Update token registry with fresh price
     */
    private updateTokenRegistryPrice(coingeckoId: string, price: number): void {
        for (const [denom, tokenInfo] of Object.entries(this.tokenRegistry)) {
            if (tokenInfo.coingeckoId === coingeckoId) {
                tokenInfo.priceUsd = price;
                tokenInfo.lastUpdated = new Date();
            }
        }
    }

    /**
     * Respect rate limiting
     */
    private async respectRateLimit(): Promise<void> {
        const now = Date.now();
        const minInterval = (60 * 1000) / this.config.rateLimitPerMinute; // ms between requests
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < minInterval) {
            const waitTime = minInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * Start periodic price refresh (excludes stables)
     */
    private startPriceRefreshInterval(): void {
        const intervalMs = this.config.cacheTtlMinutes * 60 * 1000 / 2; // Refresh at half TTL
        
        setInterval(async () => {
            try {
                // Only refresh non-stable tokens
                const nonStableCoingeckoIds = Object.values(this.tokenRegistry)
                    .filter(token => token.coingeckoId && !token.isStable)
                    .map(token => token.coingeckoId) as string[];

                if (nonStableCoingeckoIds.length > 0) {
                    await this.fetchPricesFromAPI(nonStableCoingeckoIds);
                }
            } catch (error) {
                logger.error('[PriceOracleService] Error in periodic price refresh', error);
            }
        }, intervalMs);

        logger.info(`[PriceOracleService] Started price refresh interval: ${intervalMs}ms (excluding stables)`);
    }

    /**
     * Format token amount for display
     */
    private formatTokenAmount(amount: number): string {
        if (amount >= 1000000) {
            return (amount / 1000000).toFixed(2) + 'M';
        } else if (amount >= 1000) {
            return (amount / 1000).toFixed(2) + 'K';
        } else if (amount >= 1) {
            return amount.toFixed(2);
        } else {
            return amount.toFixed(6);
        }
    }

    /**
     * Format USD amount for display
     */
    private formatUsdAmount(amount: number): string {
        if (amount >= 1000000) {
            return '$' + (amount / 1000000).toFixed(2) + 'M';
        } else if (amount >= 1000) {
            return '$' + (amount / 1000).toFixed(2) + 'K';
        } else if (amount >= 1) {
            return '$' + amount.toFixed(2);
        } else if (amount >= 0.01) {
            return '$' + amount.toFixed(4);
        } else {
            return '$' + amount.toFixed(8);
        }
    }

    /**
     * Cache stable token price with long TTL
     */
    private cacheStablePrice(denom: string, price: number): void {
        const tokenInfo = this.tokenRegistry[denom];
        const cacheKey = tokenInfo?.coingeckoId || denom;
        
        // Cache stables for much longer (1 hour) since they rarely change
        const stableTtl = 60 * 60 * 1000; // 1 hour
        
        this.priceCache.set(cacheKey, {
            price,
            timestamp: new Date(),
            ttl: stableTtl
        });
    }

    /**
     * Check if a token is a stablecoin
     */
    public isStablecoin(denom: string): boolean {
        const tokenInfo = this.tokenRegistry[denom];
        return tokenInfo?.isStable === true;
    }

    /**
     * Get statistics about cache usage including stable vs non-stable tokens
     */
    public getCacheStats(): {
        size: number;
        stableTokensCount: number;
        nonStableTokensCount: number;
        entries: Array<{ key: string; price: number; age: number; isStable?: boolean }>;
    } {
        const now = Date.now();
        const entries = Array.from(this.priceCache.entries()).map(([key, entry]) => {
            // Check if this cache entry corresponds to a stable token
            const isStable = Object.values(this.tokenRegistry).some(
                token => (token.coingeckoId === key || key.includes('usd')) && token.isStable
            );
            
            return {
                key,
                price: entry.price,
                age: now - entry.timestamp.getTime(),
                isStable
            };
        });

        return {
            size: this.priceCache.size,
            stableTokensCount: entries.filter(e => e.isStable).length,
            nonStableTokensCount: entries.filter(e => !e.isStable).length,
            entries
        };
    }

    /**
     * Clear cache (useful for testing)
     */
    public clearCache(): void {
        this.priceCache.clear();
        logger.info('[PriceOracleService] Cache cleared');
    }

    /**
     * Reset singleton instance (useful for testing)
     */
    public static resetInstance(): void {
        PriceOracleService.instance = null;
    }

    /**
     * Detect API tier based on key format or environment
     */
    private detectApiTier(apiKey?: string): boolean {
        if (!apiKey) return false;
        
        // Check environment variable for explicit tier setting
        const explicitTier = process.env.COINGECKO_API_TIER;
        if (explicitTier) {
            return explicitTier.toLowerCase() === 'pro';
        }
        
        // Try to detect based on key format (Pro keys are typically longer)
        // This is a heuristic - adjust based on actual key formats
        return apiKey.length > 50;
    }

    /**
     * Get appropriate headers based on API tier
     */
    private getApiHeaders(): Record<string, string> {
        if (!this.config.coingeckoApiKey) {
            return {}; // No API key, use free tier
        }

        // Use demo header by default, pro header if explicitly configured
        const headerName = this.config.isProApi ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key';
        
        logger.info(`[PriceOracleService] Using ${this.config.isProApi ? 'Pro' : 'Demo'} API with ${headerName}`);
        
        return {
            [headerName]: this.config.coingeckoApiKey
        };
    }
} 