import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCAnalyticsFactory } from '../../../services/ibc/analytics/IBCAnalyticsFactory';

/**
 * IBC Analytics Controller
 * Provides API endpoints for IBC analytics data required by the UI
 */
export class IBCAnalyticsController {
    private static analyticsService = IBCAnalyticsFactory.getInstance();

    /**
     * GET /api/v1/ibc/analytics/overview
     * Get complete analytics overview for dashboard
     */
    public static async getOverallAnalytics(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            
            logger.info(`[IBCAnalyticsController] Getting overall analytics for network: ${network}`);

            const analytics = await IBCAnalyticsController.analyticsService.getOverallAnalytics(network);

            res.json({
                success: true,
                data: analytics,
                network: network.toString(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[IBCAnalyticsController] Error getting overall analytics:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to fetch analytics data'
            });
        }
    }

    /**
     * GET /api/v1/ibc/analytics/channels
     * Get channel analytics including stats, volumes, and top performers
     */
    public static async getChannelAnalytics(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            
            logger.info(`[IBCAnalyticsController] Getting channel analytics for network: ${network}`);

            const analytics = await IBCAnalyticsController.analyticsService.getChannelAnalytics(network);

            res.json({
                success: true,
                data: {
                    // UI Requirements: Channels (Active)
                    channels_count: analytics.stats.total_channels,
                    active_channels_count: analytics.stats.active_channels,
                    channel_details: analytics.volumes,
                    channel_volumes: analytics.top_channels_by_volume,
                    channel_status: analytics.stats.channels_by_state,
                    top_channels_by_activity: analytics.top_channels_by_activity
                },
                network: network.toString(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[IBCAnalyticsController] Error getting channel analytics:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to fetch channel analytics'
            });
        }
    }

    /**
     * GET /api/v1/ibc/analytics/chains
     * Get connected chains analytics including details and volumes
     */
    public static async getChainAnalytics(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            
            logger.info(`[IBCAnalyticsController] Getting chain analytics for network: ${network}`);

            const analytics = await IBCAnalyticsController.analyticsService.getChainAnalytics(network);

            res.json({
                success: true,
                data: {
                    // UI Requirements: Connected Chains (renamed from chains_names to chains)
                    chains: analytics.connected_chains.map(chain => ({
                        chain_id: chain.chain_id,
                        chain_name: chain.chain_name,
                        connections: chain.connections,
                        total_received: chain.total_received,
                        total_sent: chain.total_sent
                    })),
                    chain_details: analytics.connected_chains,
                    chain_volumes_total: analytics.volumes,
                    chain_volumes_per_denom: analytics.volumes.map(chain => ({
                        chain_id: chain.chain_id,
                        chain_name: chain.chain_name,
                        volumes_by_denom: chain.volumes_by_denom
                    })),
                    transaction_counts: analytics.transaction_counts
                },
                network: network.toString(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[IBCAnalyticsController] Error getting chain analytics:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to fetch chain analytics'
            });
        }
    }

    /**
     * GET /api/v1/ibc/analytics/transactions
     * Get transaction analytics including counts and latest transactions
     * Optional query parameter: channel=channel_id to filter by specific channel
     */
    public static async getTransactionAnalytics(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 50;
            const channelId = req.query.channel as string;
            
            logger.info(`[IBCAnalyticsController] Getting transaction analytics for network: ${network}${channelId ? ` and channel: ${channelId}` : ''}`);

            const analytics = await IBCAnalyticsController.analyticsService.getTransactionAnalytics(network, channelId);

            res.json({
                success: true,
                data: {
                    // UI Requirements: Transactions
                    total_transaction_count: analytics.overall_stats.total_transactions,
                    total_successful_transactions: analytics.overall_stats.successful_transactions,
                    total_failed_transactions: analytics.overall_stats.failed_transactions,
                    overall_success_rate: analytics.overall_stats.success_rate,
                    transaction_count_per_chain: analytics.by_chain,
                    latest_transactions: analytics.latest_transactions.slice(0, limit),
                    // Add channel filter info if provided
                    ...(channelId && { channel_filter: channelId })
                },
                network: network.toString(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[IBCAnalyticsController] Error getting transaction analytics:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to fetch transaction analytics'
            });
        }
    }

    /**
     * GET /api/v1/ibc/analytics/relayers
     * Get relayer analytics including addresses, volumes, and transaction counts
     */
    public static async getRelayerAnalytics(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            
            logger.info(`[IBCAnalyticsController] Getting relayer analytics for network: ${network}`);

            const analytics = await IBCAnalyticsController.analyticsService.getRelayerAnalytics(network);

            res.json({
                success: true,
                data: {
                    // UI Requirements: Relayers
                    relayer_addresses_by_chain: analytics.by_chain,
                    relayer_volumes_total: analytics.volumes,
                    relayer_volumes_per_chain: analytics.volumes.map(relayer => ({
                        relayer_address: relayer.relayer_address,
                        volumes_by_chain: relayer.volumes_by_chain
                    })),
                    total_relayed_transactions: analytics.transaction_counts,
                    top_relayers: analytics.top_relayers
                },
                network: network.toString(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[IBCAnalyticsController] Error getting relayer analytics:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to fetch relayer analytics'
            });
        }
    }

    /**
     * GET /api/v1/ibc/analytics/summary
     * Get a high-level summary of all IBC activity
     */
    public static async getSummary(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            
            logger.info(`[IBCAnalyticsController] Getting summary analytics for network: ${network}`);

            const analytics = await IBCAnalyticsController.analyticsService.getOverallAnalytics(network);

            // Create a simplified summary for quick dashboard overview
            const summary = {
                channels: {
                    total: analytics.channels.stats.total_channels,
                    active: analytics.channels.stats.active_channels
                },
                chains: {
                    connected: analytics.chains.connected_chains.length,
                    top_by_volume: analytics.chains.volumes.slice(0, 5)
                },
                transactions: {
                    total: analytics.transactions.overall_stats.total_transactions,
                    success_rate: analytics.transactions.overall_stats.success_rate
                },
                relayers: {
                    total_active: analytics.relayers.volumes.length,
                    top_performers: analytics.relayers.top_relayers.slice(0, 5)
                }
            };

            res.json({
                success: true,
                data: summary,
                network: network.toString(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[IBCAnalyticsController] Error getting summary analytics:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to fetch summary analytics'
            });
        }
    }
}