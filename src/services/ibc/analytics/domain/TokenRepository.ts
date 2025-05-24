import { Token, TokenMetadata, TokenPrice } from './Token';

/**
 * Token Repository Interface
 * Follows Repository Pattern and Dependency Inversion Principle
 * Abstracts token storage and retrieval logic
 */
export interface ITokenRepository {
    /**
     * Get token by denomination
     */
    getToken(denom: string): Promise<Token | null>;

    /**
     * Get multiple tokens by denominations
     */
    getTokens(denoms: string[]): Promise<Map<string, Token>>;

    /**
     * Get token metadata (without price)
     */
    getTokenMetadata(denom: string): Promise<TokenMetadata | null>;

    /**
     * Update token price
     */
    updateTokenPrice(baseDenom: string, price: TokenPrice): Promise<void>;

    /**
     * Update multiple token prices
     */
    updateTokenPrices(prices: Map<string, TokenPrice>): Promise<void>;

    /**
     * Register new token metadata
     */
    registerToken(metadata: TokenMetadata): Promise<void>;

    /**
     * Check if token exists
     */
    hasToken(denom: string): Promise<boolean>;

    /**
     * Get all registered tokens
     */
    getAllTokens(): Promise<Map<string, Token>>;

    /**
     * Get tokens that need price updates
     */
    getStaleTokens(ttlMinutes?: number): Promise<Token[]>;
}

/**
 * Token Price Provider Interface
 * Follows Strategy Pattern for different pricing sources
 */
export interface IPriceProvider {
    /**
     * Get single token price
     */
    getPrice(coingeckoId: string): Promise<number>;

    /**
     * Get multiple token prices
     */
    getPrices(coingeckoIds: string[]): Promise<Map<string, number>>;

    /**
     * Provider name for logging
     */
    readonly name: string;

    /**
     * Check if provider supports given token
     */
    supports(coingeckoId: string): boolean;
}

/**
 * Token Metadata Provider Interface
 * Handles denomination parsing and metadata resolution
 */
export interface ITokenMetadataProvider {
    /**
     * Parse denomination to get base denomination
     */
    parseBaseDenom(denom: string): string;

    /**
     * Get token metadata by denomination
     */
    getMetadata(denom: string): TokenMetadata | null;

    /**
     * Register custom token mapping
     */
    registerMapping(denom: string, metadata: TokenMetadata): void;

    /**
     * Check if denomination needs custom mapping
     */
    needsMapping(denom: string): boolean;
} 