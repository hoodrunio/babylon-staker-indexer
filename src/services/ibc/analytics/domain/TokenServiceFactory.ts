import { TokenService, ITokenService } from './TokenService';
import { TokenRepositoryImpl } from './TokenRepositoryImpl';
import { TokenMetadataProviderImpl } from './TokenMetadataProviderImpl';
import { CoinGeckoPriceProvider } from './CoinGeckoPriceProvider';
import { ITokenRepository, IPriceProvider, ITokenMetadataProvider } from './TokenRepository';
import { logger } from '../../../../utils/logger';

/**
 * Token Service Factory
 */
export class TokenServiceFactory {
    private static instance: TokenServiceFactory | null = null;
    private tokenService: ITokenService | null = null;
    private tokenRepository: ITokenRepository | null = null;
    private priceProvider: IPriceProvider | null = null;
    private metadataProvider: ITokenMetadataProvider | null = null;

    private constructor() {}

    public static getInstance(): TokenServiceFactory {
        if (!TokenServiceFactory.instance) {
            TokenServiceFactory.instance = new TokenServiceFactory();
        }
        return TokenServiceFactory.instance;
    }

    /**
     * Create complete token service with all dependencies
     */
    public createTokenService(): ITokenService {
        if (this.tokenService) {
            return this.tokenService;
        }

        logger.info('[TokenServiceFactory] Creating token service dependencies...');

        // Create providers
        this.metadataProvider = this.createMetadataProvider();
        this.priceProvider = this.createPriceProvider();
        
        // Create repository with providers
        this.tokenRepository = this.createTokenRepository(
            this.metadataProvider,
            this.priceProvider
        );

        // Create main service
        this.tokenService = new TokenService(this.tokenRepository);

        logger.info('[TokenServiceFactory] Token service created successfully');
        return this.tokenService;
    }

    /**
     * Create metadata provider
     */
    public createMetadataProvider(): ITokenMetadataProvider {
        if (this.metadataProvider) {
            return this.metadataProvider;
        }

        this.metadataProvider = new TokenMetadataProviderImpl();
        logger.debug('[TokenServiceFactory] Metadata provider created');
        return this.metadataProvider;
    }

    /**
     * Create price provider (CoinGecko by default)
     */
    public createPriceProvider(): IPriceProvider {
        if (this.priceProvider) {
            return this.priceProvider;
        }

        this.priceProvider = new CoinGeckoPriceProvider();
        logger.debug('[TokenServiceFactory] Price provider created');
        return this.priceProvider;
    }

    /**
     * Create token repository with dependencies
     */
    public createTokenRepository(
        metadataProvider: ITokenMetadataProvider,
        priceProvider: IPriceProvider
    ): ITokenRepository {
        if (this.tokenRepository) {
            return this.tokenRepository;
        }

        this.tokenRepository = new TokenRepositoryImpl(metadataProvider, priceProvider);
        logger.debug('[TokenServiceFactory] Token repository created');
        return this.tokenRepository;
    }

    /**
     * Create token service with custom providers (for testing or different implementations)
     */
    public createCustomTokenService(
        metadataProvider?: ITokenMetadataProvider,
        priceProvider?: IPriceProvider
    ): ITokenService {
        const metadata = metadataProvider || this.createMetadataProvider();
        const price = priceProvider || this.createPriceProvider();
        const repository = this.createTokenRepository(metadata, price);
        
        return new TokenService(repository);
    }

    /**
     * Get existing instances (for reuse)
     */
    public getInstances(): {
        tokenService: ITokenService | null;
        tokenRepository: ITokenRepository | null;
        priceProvider: IPriceProvider | null;
        metadataProvider: ITokenMetadataProvider | null;
    } {
        return {
            tokenService: this.tokenService,
            tokenRepository: this.tokenRepository,
            priceProvider: this.priceProvider,
            metadataProvider: this.metadataProvider
        };
    }

    /**
     * Get service configuration and statistics
     */
    public async getFactoryStats(): Promise<{
        isInitialized: boolean;
        servicesCreated: {
            tokenService: boolean;
            tokenRepository: boolean;
            priceProvider: boolean;
            metadataProvider: boolean;
        };
        serviceStats?: {
            tokenCount: number;
            priceCount: number;
            staleCount: number;
            cacheStats: any;
        };
        priceProviderStats?: any;
        metadataStats?: any;
    }> {
        const servicesCreated = {
            tokenService: this.tokenService !== null,
            tokenRepository: this.tokenRepository !== null,
            priceProvider: this.priceProvider !== null,
            metadataProvider: this.metadataProvider !== null
        };

        const isInitialized = Object.values(servicesCreated).every(created => created);

        const result: any = {
            isInitialized,
            servicesCreated
        };

        // Get service stats if available
        if (this.tokenService) {
            try {
                result.serviceStats = await this.tokenService.getStats();
            } catch (error) {
                logger.warn('[TokenServiceFactory] Failed to get service stats:', error);
            }
        }

        // Get price provider stats
        if (this.priceProvider && 'getCacheStats' in this.priceProvider) {
            try {
                result.priceProviderStats = (this.priceProvider as any).getCacheStats();
            } catch (error) {
                logger.warn('[TokenServiceFactory] Failed to get price provider stats:', error);
            }
        }

        // Get metadata provider stats
        if (this.metadataProvider && 'getStats' in this.metadataProvider) {
            try {
                result.metadataStats = (this.metadataProvider as any).getStats();
            } catch (error) {
                logger.warn('[TokenServiceFactory] Failed to get metadata stats:', error);
            }
        }

        return result;
    }

    /**
     * Cleanup all services and reset factory
     */
    public async cleanup(): Promise<void> {
        logger.info('[TokenServiceFactory] Cleaning up services...');

        try {
            // Cleanup token service
            if (this.tokenService && 'cleanup' in this.tokenService) {
                await (this.tokenService as any).cleanup();
            }

            // Cleanup price provider
            if (this.priceProvider && 'clearCache' in this.priceProvider) {
                (this.priceProvider as any).clearCache();
            }

            // Cleanup repository
            if (this.tokenRepository && 'clearCache' in this.tokenRepository) {
                (this.tokenRepository as any).clearCache();
            }

            // Reset instances
            this.tokenService = null;
            this.tokenRepository = null;
            this.priceProvider = null;
            this.metadataProvider = null;

            logger.info('[TokenServiceFactory] Cleanup completed');
        } catch (error) {
            logger.error('[TokenServiceFactory] Error during cleanup:', error);
        }
    }

    /**
     * Reset factory instance (for testing)
     */
    public static resetInstance(): void {
        if (TokenServiceFactory.instance) {
            TokenServiceFactory.instance.cleanup();
            TokenServiceFactory.instance = null;
        }
    }

    /**
     * Pre-warm services (load initial data)
     */
    public async prewarmServices(): Promise<void> {
        if (!this.tokenService) {
            this.createTokenService();
        }

        logger.info('[TokenServiceFactory] Pre-warming services...');

        try {
            // Pre-load common tokens
            const commonDenoms = ['ubbn', 'uatom', 'uosmo', 'wbtc', 'uusdc'];
            await this.tokenService!.getTokens(commonDenoms);
            
            // Refresh prices
            await this.tokenService!.refreshPrices();

            logger.info('[TokenServiceFactory] Services pre-warmed successfully');
        } catch (error) {
            logger.warn('[TokenServiceFactory] Failed to pre-warm services:', error);
        }
    }
}

/**
 * Convenience function to get token service instance
 */
export function getTokenService(): ITokenService {
    return TokenServiceFactory.getInstance().createTokenService();
}

/**
 * Convenience function to get factory stats
 */
export async function getTokenServiceStats() {
    return TokenServiceFactory.getInstance().getFactoryStats();
} 