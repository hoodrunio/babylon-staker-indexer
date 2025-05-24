import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';
import {
    IChainAnalyticsProvider,
    ChainInfoResult,
    ChainVolumeResult,
    ChainTransactionCountResult
} from '../../interfaces/IBCAnalyticsService';
import { IBCChannelRepository } from '../../repository/IBCChannelRepository';
import { IBCConnectionRepository } from '../../repository/IBCConnectionRepository';
import { IBCTransferRepository } from '../../repository/IBCTransferRepository';
import { getChainName } from '../../constants/chainMapping';
import { PriceOracleService } from '../config/PriceOracleService';
import { ChainConfigService } from '../config/ChainConfigService';
import IBCTransferModel from '../../../../database/models/ibc/IBCTransfer';

/**
 * Chain Analytics Provider - follows SRP by handling only chain-related analytics
 * Implements DIP by depending on repository abstractions
 */
export class ChainAnalyticsProvider implements IChainAnalyticsProvider {
    private readonly priceOracle: PriceOracleService;
    private readonly chainConfig: ChainConfigService;

    constructor(
        private readonly channelRepository: IBCChannelRepository,
        private readonly connectionRepository: IBCConnectionRepository,
        private readonly transferRepository: IBCTransferRepository
    ) {
        this.priceOracle = PriceOracleService.getInstance();
        this.chainConfig = ChainConfigService.getInstance();
    }

    /**
     * Get information about all connected chains
     */
    async getConnectedChains(network: Network): Promise<ChainInfoResult[]> {
        try {
            logger.info(`[ChainAnalyticsProvider] Getting connected chains for network: ${network}`);

            const channels = await this.channelRepository.getAllChannels(network);
            const connections = await this.connectionRepository.getAllConnections(network);

            // Group by counterparty chain
            const chainsMap = new Map<string, ChainInfoResult>();

            channels.forEach(channel => {
                const chainId = channel.counterparty_chain_id;
                if (!chainId || chainId === 'unknown') return;

                if (!chainsMap.has(chainId)) {
                    chainsMap.set(chainId, {
                        chain_id: chainId,
                        chain_name: getChainName(chainId),
                        connection_count: 0,
                        channel_count: 0,
                        first_connected: channel.created_at,
                        last_activity: channel.updated_at
                    });
                }

                const chainInfo = chainsMap.get(chainId)!;
                chainInfo.channel_count++;
                
                // Update first/last activity times
                if (channel.created_at < chainInfo.first_connected) {
                    chainInfo.first_connected = channel.created_at;
                }
                if (channel.updated_at > chainInfo.last_activity) {
                    chainInfo.last_activity = channel.updated_at;
                }
            });

            // Count connections per chain
            connections.forEach(connection => {
                const chainId = connection.counterparty_chain_id;
                if (chainsMap.has(chainId)) {
                    chainsMap.get(chainId)!.connection_count++;
                }
            });

            return Array.from(chainsMap.values()).sort((a, b) => 
                b.channel_count - a.channel_count
            );
        } catch (error) {
            logger.error('[ChainAnalyticsProvider] Error getting connected chains:', error);
            throw error;
        }
    }

    /**
     * Get volume statistics for each connected chain
     */
    async getChainVolumes(network: Network): Promise<ChainVolumeResult[]> {
        try {
            logger.info(`[ChainAnalyticsProvider] Getting chain volumes for network: ${network}`);

            // Get all successful transfers
            const transfers = await IBCTransferModel.find({
                network: network.toString(),
                success: true
            });

            // Group volumes by chain
            const chainVolumesMap = new Map<string, {
                incoming: Record<string, number>;
                outgoing: Record<string, number>;
            }>();

            // Get all unique denominations for batch price fetching
            const uniqueDenoms = new Set<string>();
            transfers.forEach(transfer => uniqueDenoms.add(transfer.denom));

            // Batch fetch all prices
            const prices = await this.priceOracle.getMultipleTokenPrices(Array.from(uniqueDenoms));

            transfers.forEach(transfer => {
                const sourceChain = transfer.source_chain_id;
                const destChain = transfer.destination_chain_id;
                const amount = parseFloat(transfer.amount);
                const denom = transfer.denom;

                // Initialize chain maps if they don't exist
                if (!chainVolumesMap.has(sourceChain)) {
                    chainVolumesMap.set(sourceChain, { incoming: {}, outgoing: {} });
                }
                if (!chainVolumesMap.has(destChain)) {
                    chainVolumesMap.set(destChain, { incoming: {}, outgoing: {} });
                }

                // Track outgoing volume for source chain
                const sourceData = chainVolumesMap.get(sourceChain)!;
                sourceData.outgoing[denom] = (sourceData.outgoing[denom] || 0) + amount;

                // Track incoming volume for destination chain
                const destData = chainVolumesMap.get(destChain)!;
                destData.incoming[denom] = (destData.incoming[denom] || 0) + amount;
            });

            // Convert to result format
            const chainVolumes: ChainVolumeResult[] = [];
            
            for (const [chainId, volumes] of chainVolumesMap.entries()) {
                // Skip home chain based on network configuration
                if (this.chainConfig.isHomeChain(chainId, network)) continue;

                const volumes_by_denom: Record<string, string> = {};
                let incoming_volume_usd = 0;
                let outgoing_volume_usd = 0;

                // Combine incoming and outgoing volumes
                Object.entries(volumes.incoming).forEach(([denom, amount]) => {
                    volumes_by_denom[denom] = (parseFloat(volumes_by_denom[denom] || '0') + amount).toString();
                    incoming_volume_usd += this.convertToUSD(denom, amount, prices);
                });

                Object.entries(volumes.outgoing).forEach(([denom, amount]) => {
                    volumes_by_denom[denom] = (parseFloat(volumes_by_denom[denom] || '0') + amount).toString();
                    outgoing_volume_usd += this.convertToUSD(denom, amount, prices);
                });

                chainVolumes.push({
                    chain_id: chainId,
                    chain_name: getChainName(chainId),
                    total_volume_usd: (incoming_volume_usd + outgoing_volume_usd).toString(),
                    volumes_by_denom,
                    incoming_volume: incoming_volume_usd.toString(),
                    outgoing_volume: outgoing_volume_usd.toString()
                });
            }

            return chainVolumes.sort((a, b) => 
                parseFloat(b.total_volume_usd) - parseFloat(a.total_volume_usd)
            );
        } catch (error) {
            logger.error('[ChainAnalyticsProvider] Error getting chain volumes:', error);
            throw error;
        }
    }

    /**
     * Get transaction counts for each connected chain
     */
    async getChainTransactionCounts(network: Network): Promise<ChainTransactionCountResult[]> {
        try {
            logger.info(`[ChainAnalyticsProvider] Getting chain transaction counts for network: ${network}`);

            const transfers = await IBCTransferModel.find({
                network: network.toString()
            });

            // Group by chain (considering both source and destination)
            const chainStatsMap = new Map<string, {
                total: number;
                successful: number;
                failed: number;
            }>();

            transfers.forEach(transfer => {
                const chains = [transfer.source_chain_id, transfer.destination_chain_id];
                
                chains.forEach(chainId => {
                    // Skip home chain based on network configuration
                    if (this.chainConfig.isHomeChain(chainId, network)) return;

                    if (!chainStatsMap.has(chainId)) {
                        chainStatsMap.set(chainId, { total: 0, successful: 0, failed: 0 });
                    }

                    const stats = chainStatsMap.get(chainId)!;
                    stats.total++;
                    
                    if (transfer.success) {
                        stats.successful++;
                    } else {
                        stats.failed++;
                    }
                });
            });

            return Array.from(chainStatsMap.entries()).map(([chainId, stats]) => ({
                chain_id: chainId,
                chain_name: getChainName(chainId),
                total_transactions: stats.total,
                successful_transactions: stats.successful,
                failed_transactions: stats.failed,
                success_rate: stats.total > 0 ? (stats.successful / stats.total) : 0
            })).sort((a, b) => b.total_transactions - a.total_transactions);
        } catch (error) {
            logger.error('[ChainAnalyticsProvider] Error getting chain transaction counts:', error);
            throw error;
        }
    }

    /**
     * Convert token amount to USD using pre-fetched prices
     */
    private convertToUSD(denom: string, amount: number, prices: Record<string, number>): number {
        try {
            const tokenInfo = this.priceOracle.getTokenInfo(denom);
            if (!tokenInfo || !prices[denom]) {
                return 0;
            }

            const mainUnitAmount = amount / Math.pow(10, tokenInfo.decimals);
            return mainUnitAmount * prices[denom];
        } catch (error) {
            logger.warn(`[ChainAnalyticsProvider] Error converting ${denom} to USD:`, error);
            return 0;
        }
    }
} 