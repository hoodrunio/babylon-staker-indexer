import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import {
    IBCAnalyticsService,
    ChannelAnalyticsResult,
    ChainAnalyticsResult,
    TransactionAnalyticsResult,
    RelayerAnalyticsResult,
    OverallAnalyticsResult,
    IChannelAnalyticsProvider,
    IChainAnalyticsProvider,
    ITransactionAnalyticsProvider,
    IRelayerAnalyticsProvider
} from '../interfaces/IBCAnalyticsService';

/**
 * Main IBC Analytics Service implementation
 * Follows SOLID principles:
 * - SRP: Orchestrates analytics data from specialized providers
 * - OCP: Open for extension by adding new provider types
 * - LSP: Can be substituted with any IBCAnalyticsService implementation  
 * - ISP: Depends on specific provider interfaces
 * - DIP: Depends on abstractions (provider interfaces), not concrete implementations
 */
export class IBCAnalyticsServiceImpl implements IBCAnalyticsService {
    constructor(
        private readonly channelProvider: IChannelAnalyticsProvider,
        private readonly chainProvider: IChainAnalyticsProvider,
        private readonly transactionProvider: ITransactionAnalyticsProvider,
        private readonly relayerProvider: IRelayerAnalyticsProvider
    ) {}

    /**
     * Get comprehensive channel analytics
     */
    async getChannelAnalytics(network: Network): Promise<ChannelAnalyticsResult> {
        try {
            logger.info(`[IBCAnalyticsService] Getting channel analytics for network: ${network}`);

            const [stats, volumes] = await Promise.all([
                this.channelProvider.getChannelStats(network),
                this.channelProvider.getChannelVolumes(network)
            ]);

            // Get top channels by volume (top 10)
            const top_channels_by_volume = volumes.slice(0, 10);

            // Get top channels by activity (top 10 by packet count)
            const top_channels_by_activity = [...volumes]
                .sort((a, b) => b.packet_count - a.packet_count)
                .slice(0, 10);

            return {
                stats,
                volumes,
                top_channels_by_volume,
                top_channels_by_activity
            };
        } catch (error) {
            logger.error('[IBCAnalyticsService] Error getting channel analytics:', error);
            throw error;
        }
    }

    /**
     * Get comprehensive chain analytics
     */
    async getChainAnalytics(network: Network): Promise<ChainAnalyticsResult> {
        try {
            logger.info(`[IBCAnalyticsService] Getting chain analytics for network: ${network}`);

            const [connected_chains, volumes, transaction_counts] = await Promise.all([
                this.chainProvider.getConnectedChains(network),
                this.chainProvider.getChainVolumes(network),
                this.chainProvider.getChainTransactionCounts(network)
            ]);

            return {
                connected_chains,
                volumes,
                transaction_counts
            };
        } catch (error) {
            logger.error('[IBCAnalyticsService] Error getting chain analytics:', error);
            throw error;
        }
    }

    /**
     * Get comprehensive transaction analytics
     */
    async getTransactionAnalytics(network: Network): Promise<TransactionAnalyticsResult> {
        try {
            logger.info(`[IBCAnalyticsService] Getting transaction analytics for network: ${network}`);

            const [overall_stats, by_chain, latest_transactions] = await Promise.all([
                this.transactionProvider.getTotalTransactionCount(network),
                this.transactionProvider.getTransactionCountsByChain(network),
                this.transactionProvider.getLatestTransactions(50, network) // Get latest 50 transactions
            ]);

            return {
                overall_stats,
                by_chain,
                latest_transactions
            };
        } catch (error) {
            logger.error('[IBCAnalyticsService] Error getting transaction analytics:', error);
            throw error;
        }
    }

    /**
     * Get comprehensive relayer analytics
     */
    async getRelayerAnalytics(network: Network): Promise<RelayerAnalyticsResult> {
        try {
            logger.info(`[IBCAnalyticsService] Getting relayer analytics for network: ${network}`);

            const [by_chain, volumes, transaction_counts] = await Promise.all([
                this.relayerProvider.getRelayersByChain(network),
                this.relayerProvider.getRelayerVolumes(network),
                this.relayerProvider.getRelayerTransactionCounts(network)
            ]);

            // Get top 10 relayers by volume
            const top_relayers = volumes.slice(0, 10);

            return {
                by_chain,
                volumes,
                transaction_counts,
                top_relayers
            };
        } catch (error) {
            logger.error('[IBCAnalyticsService] Error getting relayer analytics:', error);
            throw error;
        }
    }

    /**
     * Get complete analytics overview for the UI dashboard
     */
    async getOverallAnalytics(network: Network): Promise<OverallAnalyticsResult> {
        try {
            logger.info(`[IBCAnalyticsService] Getting overall analytics for network: ${network}`);

            // Run all analytics in parallel for better performance
            const [channels, chains, transactions, relayers] = await Promise.all([
                this.getChannelAnalytics(network),
                this.getChainAnalytics(network),
                this.getTransactionAnalytics(network),
                this.getRelayerAnalytics(network)
            ]);

            return {
                channels,
                chains,
                transactions,
                relayers
            };
        } catch (error) {
            logger.error('[IBCAnalyticsService] Error getting overall analytics:', error);
            throw error;
        }
    }
} 