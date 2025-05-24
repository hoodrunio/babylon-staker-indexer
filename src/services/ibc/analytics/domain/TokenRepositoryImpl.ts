import { Token, TokenMetadata, TokenPrice } from './Token';
import { ITokenRepository, IPriceProvider, ITokenMetadataProvider } from './TokenRepository';
import { logger } from '../../../../utils/logger';

/**
 * In-Memory Token Repository Implementation
 * Provides centralized token management with caching
 */
export class TokenRepositoryImpl implements ITokenRepository {
    private readonly tokenCache = new Map<string, Token>();
    private readonly metadataProvider: ITokenMetadataProvider;
    private readonly priceProvider: IPriceProvider;

    constructor(
        metadataProvider: ITokenMetadataProvider,
        priceProvider: IPriceProvider
    ) {
        this.metadataProvider = metadataProvider;
        this.priceProvider = priceProvider;
    }

    async getToken(denom: string): Promise<Token | null> {
        const baseDenom = this.metadataProvider.parseBaseDenom(denom);
        
        // Check cache first
        if (this.tokenCache.has(baseDenom)) {
            return this.tokenCache.get(baseDenom)!;
        }

        // Get metadata
        const metadata = this.metadataProvider.getMetadata(denom);
        if (!metadata) {
            logger.warn(`[TokenRepository] No metadata found for denom: ${denom}`);
            return null;
        }

        // Create token without price initially
        const token = new Token(metadata);
        this.tokenCache.set(baseDenom, token);

        // Try to fetch price asynchronously
        this.fetchAndUpdatePrice(baseDenom, metadata.coingeckoId);

        return token;
    }

    async getTokens(denoms: string[]): Promise<Map<string, Token>> {
        const result = new Map<string, Token>();
        const missingTokens: string[] = [];

        // Check cache for existing tokens
        for (const denom of denoms) {
            const baseDenom = this.metadataProvider.parseBaseDenom(denom);
            if (this.tokenCache.has(baseDenom)) {
                result.set(denom, this.tokenCache.get(baseDenom)!);
            } else {
                missingTokens.push(denom);
            }
        }

        // Load missing tokens
        for (const denom of missingTokens) {
            const token = await this.getToken(denom);
            if (token) {
                result.set(denom, token);
            }
        }

        return result;
    }

    async getTokenMetadata(denom: string): Promise<TokenMetadata | null> {
        return this.metadataProvider.getMetadata(denom);
    }

    async updateTokenPrice(baseDenom: string, price: TokenPrice): Promise<void> {
        const existingToken = this.tokenCache.get(baseDenom);
        if (existingToken) {
            const updatedToken = existingToken.withPrice(price);
            this.tokenCache.set(baseDenom, updatedToken);
            logger.debug(`[TokenRepository] Updated price for ${baseDenom}: $${price.price} (${price.source})`);
        }
    }

    async updateTokenPrices(prices: Map<string, TokenPrice>): Promise<void> {
        for (const [baseDenom, price] of prices) {
            await this.updateTokenPrice(baseDenom, price);
        }
    }

    async registerToken(metadata: TokenMetadata): Promise<void> {
        const token = new Token(metadata);
        this.tokenCache.set(metadata.baseDenom, token);
        this.metadataProvider.registerMapping(metadata.originalDenom, metadata);
        
        logger.info(`[TokenRepository] Registered token: ${metadata.symbol} (${metadata.baseDenom})`);

        // Try to fetch price if coingeckoId is available
        if (metadata.coingeckoId) {
            this.fetchAndUpdatePrice(metadata.baseDenom, metadata.coingeckoId);
        }
    }

    async hasToken(denom: string): Promise<boolean> {
        const baseDenom = this.metadataProvider.parseBaseDenom(denom);
        return this.tokenCache.has(baseDenom) || this.metadataProvider.getMetadata(denom) !== null;
    }

    async getAllTokens(): Promise<Map<string, Token>> {
        return new Map(this.tokenCache);
    }

    async getStaleTokens(ttlMinutes: number = 5): Promise<Token[]> {
        const staleTokens: Token[] = [];
        
        for (const token of this.tokenCache.values()) {
            if (token.coingeckoId && token.isPriceStale(ttlMinutes)) {
                staleTokens.push(token);
            }
        }

        return staleTokens;
    }

    /**
     * Batch refresh prices for stale tokens
     */
    async refreshStalePrices(ttlMinutes: number = 5): Promise<void> {
        const staleTokens = await this.getStaleTokens(ttlMinutes);
        if (staleTokens.length === 0) return;

        const coingeckoIds = staleTokens
            .map(token => token.coingeckoId)
            .filter(id => id !== undefined) as string[];

        if (coingeckoIds.length === 0) return;

        try {
            const prices = await this.priceProvider.getPrices(coingeckoIds);
            const priceUpdates = new Map<string, TokenPrice>();

            for (const token of staleTokens) {
                if (token.coingeckoId && prices.has(token.coingeckoId)) {
                    priceUpdates.set(token.baseDenom, {
                        price: prices.get(token.coingeckoId)!,
                        lastUpdated: new Date(),
                        source: 'coingecko'
                    });
                }
            }

            await this.updateTokenPrices(priceUpdates);
            logger.info(`[TokenRepository] Refreshed prices for ${priceUpdates.size} tokens`);

        } catch (error) {
            logger.error('[TokenRepository] Failed to refresh stale prices:', error);
        }
    }

    /**
     * Get repository statistics
     */
    getStats(): {
        totalTokens: number;
        tokensWithPrices: number;
        staleTokens: number;
        cacheHitRate?: number;
    } {
        const totalTokens = this.tokenCache.size;
        const tokensWithPrices = Array.from(this.tokenCache.values())
            .filter(token => token.hasPrice).length;
        const staleTokens = Array.from(this.tokenCache.values())
            .filter(token => token.isPriceStale()).length;

        return {
            totalTokens,
            tokensWithPrices,
            staleTokens
        };
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.tokenCache.clear();
        logger.info('[TokenRepository] Cache cleared');
    }

    private async fetchAndUpdatePrice(baseDenom: string, coingeckoId?: string): Promise<void> {
        if (!coingeckoId || !this.priceProvider.supports(coingeckoId)) return;

        try {
            const price = await this.priceProvider.getPrice(coingeckoId);
            await this.updateTokenPrice(baseDenom, {
                price,
                lastUpdated: new Date(),
                source: 'coingecko'
            });
        } catch (error) {
            logger.warn(`[TokenRepository] Failed to fetch price for ${baseDenom}:`, error);
        }
    }
} 