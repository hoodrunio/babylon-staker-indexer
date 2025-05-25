import { IBCAnalyticsService } from '../interfaces/IBCAnalyticsService';
import { IBCAnalyticsServiceImpl } from './IBCAnalyticsService';
import { ChannelAnalyticsProvider } from './providers/ChannelAnalyticsProvider';
import { ChainAnalyticsProvider } from './providers/ChainAnalyticsProvider';
import { TransactionAnalyticsProvider } from './providers/TransactionAnalyticsProvider';
import { RelayerAnalyticsProvider } from './providers/RelayerAnalyticsProvider';

// Repository imports
import { IBCChannelRepository } from '../repository/IBCChannelRepository';
import { IBCConnectionRepository } from '../repository/IBCConnectionRepository';
import { IBCTransferRepository } from '../repository/IBCTransferRepository';
import { IBCPacketRepository } from '../repository/IBCPacketRepository';
import { IBCRelayerRepository } from '../repository/IBCRelayerRepository';
import { IBCClientRepository } from '../repository/IBCClientRepository';

// Service imports
import { IBCChainResolverService } from '../transfer/services/IBCChainResolverService';
import { BabylonClient } from '../../../clients/BabylonClient';

/**
 * Factory for creating IBC Analytics Service instances
 * Follows SOLID principles:
 * - SRP: Responsible only for creating analytics service instances
 * - OCP: Can be extended to support different analytics service configurations
 * - DIP: Assembles dependencies using dependency injection pattern
 */
export class IBCAnalyticsFactory {
    private static instance: IBCAnalyticsService | null = null;

    /**
     * Create a new IBC Analytics Service instance with all dependencies
     */
    public static createAnalyticsService(): IBCAnalyticsService {
        // Create repository instances
        const channelRepository = new IBCChannelRepository();
        const connectionRepository = new IBCConnectionRepository();
        const transferRepository = new IBCTransferRepository();
        const packetRepository = new IBCPacketRepository();
        const relayerRepository = new IBCRelayerRepository();
        const clientRepository = new IBCClientRepository();

        // Create service instances
        const babylonClient = BabylonClient.getInstance();
        const chainResolverService = new IBCChainResolverService(
            channelRepository,
            connectionRepository,
            clientRepository,
            babylonClient
        );

        // Create provider instances with injected dependencies
        const channelProvider = new ChannelAnalyticsProvider(
            channelRepository,
            transferRepository,
            packetRepository,
            chainResolverService
        );

        const chainProvider = new ChainAnalyticsProvider(
            channelRepository,
            connectionRepository,
            transferRepository,
            clientRepository
        );

        const transactionProvider = new TransactionAnalyticsProvider(
            transferRepository
        );

        const relayerProvider = new RelayerAnalyticsProvider(
            relayerRepository
        );

        // Create and return the main analytics service
        return new IBCAnalyticsServiceImpl(
            channelProvider,
            chainProvider,
            transactionProvider,
            relayerProvider
        );
    }

    /**
     * Get singleton instance of the analytics service
     * Useful for performance optimization in production
     */
    public static getInstance(): IBCAnalyticsService {
        if (!IBCAnalyticsFactory.instance) {
            IBCAnalyticsFactory.instance = IBCAnalyticsFactory.createAnalyticsService();
        }
        
        return IBCAnalyticsFactory.instance;
    }

    /**
     * Reset the singleton instance (useful for testing)
     */
    public static resetInstance(): void {
        IBCAnalyticsFactory.instance = null;
    }
} 