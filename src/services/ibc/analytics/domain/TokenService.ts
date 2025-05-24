import { Token, TokenAmount, TokenMetadata } from './Token';
import { ITokenRepository } from './TokenRepository';
import { logger } from '../../../../utils/logger';

/**
 * Token Service Interface
 * Defines high-level token operations
 */
export interface ITokenService {
    /**
     * Get token with enriched information (metadata + price)
     */
    getToken(denom: string): Promise<Token | null>;

    /**
     * Get multiple tokens efficiently
     */
    getTokens(denoms: string[]): Promise<Map<string, Token>>;

    /**
     * Convert amount to USD value
     */
    convertToUsd(denom: string, amount: string | number): Promise<number>;

    /**
     * Create TokenAmount object
     */
    createTokenAmount(denom: string, amount: string | number): Promise<TokenAmount | null>;

    /**
     * Get display information for UI
     */
    getDisplayInfo(denom: string, amount: string | number): Promise<{
        symbol: string;
        formattedAmount: string;
        usdValue: number;
        formattedUsdValue: string;
        hasPrice: boolean;
        priceAge?: string;
    } | null>;

    /**
     * Batch convert denominations to USD values
     */
    convertBatchToUsd(denomAmounts: Array<{ denom: string; amount: string | number }>): Promise<{
        total: number;
        breakdown: Array<{ denom: string; symbol: string; amount: number; usdValue: number; hasPrice: boolean }>;
    }>;

    /**
     * Register new token
     */
    registerToken(metadata: TokenMetadata): Promise<void>;

    /**
     * Refresh stale prices
     */
    refreshPrices(): Promise<void>;

    /**
     * Get service statistics
     */
    getStats(): Promise<{
        tokenCount: number;
        priceCount: number;
        staleCount: number;
        cacheStats: any;
    }>;
}

/**
 * Token Service Implementation
 * Provides high-level token operations with caching and optimization
 * Follows Facade Pattern and Dependency Injection
 */
export class TokenService implements ITokenService {
    private readonly tokenRepository: ITokenRepository;

    constructor(tokenRepository: ITokenRepository) {
        this.tokenRepository = tokenRepository;
    }

    async getToken(denom: string): Promise<Token | null> {
        try {
            return await this.tokenRepository.getToken(denom);
        } catch (error) {
            logger.error(`[TokenService] Failed to get token ${denom}:`, error);
            return null;
        }
    }

    async getTokens(denoms: string[]): Promise<Map<string, Token>> {
        try {
            if (denoms.length === 0) return new Map();
            
            const uniqueDenoms = [...new Set(denoms)]; // Remove duplicates
            return await this.tokenRepository.getTokens(uniqueDenoms);
        } catch (error) {
            logger.error(`[TokenService] Failed to get tokens:`, error);
            return new Map();
        }
    }

    async convertToUsd(denom: string, amount: string | number): Promise<number> {
        try {
            const token = await this.getToken(denom);
            if (!token) return 0;
            
            return token.toUsdValue(amount);
        } catch (error) {
            logger.error(`[TokenService] Failed to convert ${denom} to USD:`, error);
            return 0;
        }
    }

    async createTokenAmount(denom: string, amount: string | number): Promise<TokenAmount | null> {
        try {
            const token = await this.getToken(denom);
            if (!token) return null;
            
            return new TokenAmount(token, amount);
        } catch (error) {
            logger.error(`[TokenService] Failed to create TokenAmount for ${denom}:`, error);
            return null;
        }
    }

    async getDisplayInfo(denom: string, amount: string | number): Promise<{
        symbol: string;
        formattedAmount: string;
        usdValue: number;
        formattedUsdValue: string;
        hasPrice: boolean;
        priceAge?: string;
    } | null> {
        try {
            const token = await this.getToken(denom);
            if (!token) return null;
            
            return token.getDisplayInfo(amount);
        } catch (error) {
            logger.error(`[TokenService] Failed to get display info for ${denom}:`, error);
            return null;
        }
    }

    async convertBatchToUsd(denomAmounts: Array<{ denom: string; amount: string | number }>): Promise<{
        total: number;
        breakdown: Array<{ denom: string; symbol: string; amount: number; usdValue: number; hasPrice: boolean }>;
    }> {
        try {
            if (denomAmounts.length === 0) {
                return { total: 0, breakdown: [] };
            }

            // Get all unique denominations
            const uniqueDenoms = [...new Set(denomAmounts.map(item => item.denom))];
            const tokens = await this.getTokens(uniqueDenoms);

            let total = 0;
            const breakdown: Array<{ denom: string; symbol: string; amount: number; usdValue: number; hasPrice: boolean }> = [];

            for (const item of denomAmounts) {
                const token = tokens.get(item.denom);
                if (token) {
                    const usdValue = token.toUsdValue(item.amount);
                    const mainUnitAmount = token.toMainUnit(item.amount);
                    
                    breakdown.push({
                        denom: item.denom,
                        symbol: token.symbol,
                        amount: mainUnitAmount,
                        usdValue,
                        hasPrice: token.hasPrice
                    });

                    total += usdValue;
                } else {
                    // Unknown token
                    breakdown.push({
                        denom: item.denom,
                        symbol: 'UNKNOWN',
                        amount: typeof item.amount === 'string' ? parseFloat(item.amount) : item.amount,
                        usdValue: 0,
                        hasPrice: false
                    });
                }
            }

            return { total, breakdown };
        } catch (error) {
            logger.error('[TokenService] Failed to convert batch to USD:', error);
            return { total: 0, breakdown: [] };
        }
    }

    async registerToken(metadata: TokenMetadata): Promise<void> {
        try {
            await this.tokenRepository.registerToken(metadata);
            logger.info(`[TokenService] Registered token: ${metadata.symbol} (${metadata.baseDenom})`);
        } catch (error) {
            logger.error(`[TokenService] Failed to register token ${metadata.baseDenom}:`, error);
            throw error;
        }
    }

    async refreshPrices(): Promise<void> {
        try {
            // Type assertion to access implementation-specific method
            if ('refreshStalePrices' in this.tokenRepository) {
                await (this.tokenRepository as any).refreshStalePrices();
                logger.info('[TokenService] Refreshed stale prices');
            }
        } catch (error) {
            logger.error('[TokenService] Failed to refresh prices:', error);
        }
    }

    async getStats(): Promise<{
        tokenCount: number;
        priceCount: number;
        staleCount: number;
        cacheStats: any;
    }> {
        try {
            const allTokens = await this.tokenRepository.getAllTokens();
            const staleTokens = await this.tokenRepository.getStaleTokens();
            
            const tokensWithPrices = Array.from(allTokens.values())
                .filter(token => token.hasPrice).length;

            // Get cache stats if available
            let cacheStats = {};
            if ('getStats' in this.tokenRepository) {
                cacheStats = (this.tokenRepository as any).getStats();
            }

            return {
                tokenCount: allTokens.size,
                priceCount: tokensWithPrices,
                staleCount: staleTokens.length,
                cacheStats
            };
        } catch (error) {
            logger.error('[TokenService] Failed to get stats:', error);
            return { tokenCount: 0, priceCount: 0, staleCount: 0, cacheStats: {} };
        }
    }

    /**
     * Helper method to aggregate volumes by denomination
     */
    async aggregateVolumesByDenom(volumes: Record<string, number>): Promise<{
        totalUsd: number;
        byDenom: Array<{
            denom: string;
            symbol: string;
            amount: number;
            usdValue: number;
            percentage: number;
            hasPrice: boolean;
        }>;
    }> {
        const denomAmounts = Object.entries(volumes).map(([denom, amount]) => ({ denom, amount }));
        const { total, breakdown } = await this.convertBatchToUsd(denomAmounts);

        const byDenom = breakdown.map(item => ({
            ...item,
            percentage: total > 0 ? (item.usdValue / total) * 100 : 0
        })).sort((a, b) => b.usdValue - a.usdValue);

        return {
            totalUsd: total,
            byDenom
        };
    }

    /**
     * Helper method to format volume display
     */
    async formatVolumeDisplay(denom: string, amount: number): Promise<{
        formatted: string;
        usdFormatted: string;
        symbol: string;
    }> {
        const token = await this.getToken(denom);
        if (!token) {
            return {
                formatted: `${amount} UNKNOWN`,
                usdFormatted: '$0.00',
                symbol: 'UNKNOWN'
            };
        }

        return {
            formatted: token.formatAmount(amount),
            usdFormatted: token.formatUsdValue(amount),
            symbol: token.symbol
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup(): Promise<void> {
        try {
            if ('clearCache' in this.tokenRepository) {
                (this.tokenRepository as any).clearCache();
            }
            logger.info('[TokenService] Cleanup completed');
        } catch (error) {
            logger.error('[TokenService] Failed to cleanup:', error);
        }
    }
} 