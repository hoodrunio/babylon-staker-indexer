import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';
import {
    ITransactionAnalyticsProvider,
    TransactionCountResult,
    TransactionResult,
    ChainTransactionCountResult
} from '../../interfaces/IBCAnalyticsService';
import { IBCTransferRepository } from '../../repository/IBCTransferRepository';
import { ChainConfigService } from '../config/ChainConfigService';
import { getChainName } from '../../constants/chainMapping';
import IBCTransferModel from '../../../../database/models/ibc/IBCTransfer';

/**
 * Transaction Analytics Provider - follows SRP by handling only transaction-related analytics
 * Already uses only chain configuration - no price/denom handling needed
 */
export class TransactionAnalyticsProvider implements ITransactionAnalyticsProvider {
    private readonly chainConfig: ChainConfigService;

    constructor(
        private readonly transferRepository: IBCTransferRepository
    ) {
        this.chainConfig = ChainConfigService.getInstance();
    }

    /**
     * Get overall transaction count statistics
     */
    async getTotalTransactionCount(network: Network, channelId?: string): Promise<TransactionCountResult> {
        try {
            logger.info(`[TransactionAnalyticsProvider] Getting total transaction count for network: ${network}${channelId ? ` and channel: ${channelId}` : ''}`);

            // Build query filter
            const filter: any = {
                network: network.toString()
            };

            // If channelId is provided, filter by channel (either source or destination)
            if (channelId) {
                filter.$or = [
                    { source_channel: channelId },
                    { destination_channel: channelId }
                ];
            }

            const totalTransfers = await IBCTransferModel.countDocuments(filter);

            const successfulTransfers = await IBCTransferModel.countDocuments({
                ...filter,
                success: true
            });

            const failedTransfers = totalTransfers - successfulTransfers;
            const success_rate = totalTransfers > 0 ? (successfulTransfers / totalTransfers) * 100 : 0;

            return {
                total_transactions: totalTransfers,
                successful_transactions: successfulTransfers,
                failed_transactions: failedTransfers,
                success_rate: Math.round(success_rate * 100) / 100
            };
        } catch (error) {
            logger.error('[TransactionAnalyticsProvider] Error getting total transaction count:', error);
            throw error;
        }
    }

    /**
     * Get latest transactions with details
     */
    async getLatestTransactions(limit: number, network: Network, channelId?: string): Promise<TransactionResult[]> {
        try {
            logger.info(`[TransactionAnalyticsProvider] Getting latest ${limit} transactions for network: ${network}${channelId ? ` and channel: ${channelId}` : ''}`);

            // Build query filter
            const filter: any = {
                network: network.toString()
            };

            // If channelId is provided, filter by channel (either source or destination)
            if (channelId) {
                filter.$or = [
                    { source_channel: channelId },
                    { destination_channel: channelId }
                ];
            }

            const transfers = await IBCTransferModel.find(filter)
            .sort({ send_time: -1 })
            .limit(limit)
            .lean();

            return transfers.map(transfer => ({
                tx_hash: transfer.tx_hash,
                source_chain_id: transfer.source_chain_id,
                destination_chain_id: transfer.destination_chain_id,
                source_channel: transfer.source_channel,
                destination_channel: transfer.destination_channel,
                amount: transfer.amount,
                denom: transfer.denom,
                sender: transfer.sender,
                receiver: transfer.receiver,
                timestamp: transfer.send_time,
                success: transfer.success,
                completion_time_ms: transfer.complete_time && transfer.send_time ? 
                    transfer.complete_time.getTime() - transfer.send_time.getTime() : undefined
            }));
        } catch (error) {
            logger.error('[TransactionAnalyticsProvider] Error getting latest transactions:', error);
            throw error;
        }
    }

    /**
     * Get transaction counts broken down by chain
     */
    async getTransactionCountsByChain(network: Network, channelId?: string): Promise<ChainTransactionCountResult[]> {
        try {
            logger.info(`[TransactionAnalyticsProvider] Getting transaction counts by chain for network: ${network}${channelId ? ` and channel: ${channelId}` : ''}`);

            // Build match filter
            const matchFilter: any = {
                network: network.toString()
            };

            // If channelId is provided, filter by channel (either source or destination)
            if (channelId) {
                matchFilter.$or = [
                    { source_channel: channelId },
                    { destination_channel: channelId }
                ];
            }

            // Aggregate transactions by chain using MongoDB aggregation pipeline
            const pipeline = [
                {
                    $match: matchFilter
                },
                {
                    // Create documents for both source and destination chains
                    $facet: {
                        sourceChains: [
                            {
                                $group: {
                                    _id: '$source_chain_id',
                                    total_transactions: { $sum: 1 },
                                    successful_transactions: {
                                        $sum: { $cond: ['$success', 1, 0] }
                                    }
                                }
                            }
                        ],
                        destChains: [
                            {
                                $group: {
                                    _id: '$destination_chain_id',
                                    total_transactions: { $sum: 1 },
                                    successful_transactions: {
                                        $sum: { $cond: ['$success', 1, 0] }
                                    }
                                }
                            }
                        ]
                    }
                },
                {
                    // Combine source and destination chain data
                    $project: {
                        chains: {
                            $setUnion: [
                                { $map: { input: '$sourceChains', as: 'chain', in: '$$chain._id' } },
                                { $map: { input: '$destChains', as: 'chain', in: '$$chain._id' } }
                            ]
                        },
                        sourceData: '$sourceChains',
                        destData: '$destChains'
                    }
                }
            ];

            const aggregationResult = await IBCTransferModel.aggregate(pipeline);
            
            if (!aggregationResult.length) {
                return [];
            }

            const result = aggregationResult[0];
            const chainStatsMap = new Map<string, ChainTransactionCountResult>();

            // Process source chain data
            result.sourceData.forEach((chainData: any) => {
                const chainId = chainData._id;
                // Skip home chain based on network configuration
                if (this.chainConfig.isHomeChain(chainId, network)) return;

                const stats = chainStatsMap.get(chainId) || {
                    chain_id: chainId,
                    chain_name: getChainName(chainId),
                    total_transactions: 0,
                    successful_transactions: 0,
                    failed_transactions: 0,
                    success_rate: 0
                };

                stats.total_transactions += chainData.total_transactions;
                stats.successful_transactions += chainData.successful_transactions;
                
                chainStatsMap.set(chainId, stats);
            });

            // Process destination chain data
            result.destData.forEach((chainData: any) => {
                const chainId = chainData._id;
                // Skip home chain based on network configuration
                if (this.chainConfig.isHomeChain(chainId, network)) return;

                const stats = chainStatsMap.get(chainId) || {
                    chain_id: chainId,
                    chain_name: getChainName(chainId),
                    total_transactions: 0,
                    successful_transactions: 0,
                    failed_transactions: 0,
                    success_rate: 0
                };

                stats.total_transactions += chainData.total_transactions;
                stats.successful_transactions += chainData.successful_transactions;
                
                chainStatsMap.set(chainId, stats);
            });

            // Calculate derived fields
            const chainResults: ChainTransactionCountResult[] = [];
            
            for (const stats of chainStatsMap.values()) {
                stats.failed_transactions = stats.total_transactions - stats.successful_transactions;
                stats.success_rate = stats.total_transactions > 0 ? 
                    Math.round((stats.successful_transactions / stats.total_transactions) * 10000) / 100 : 0;
                
                chainResults.push(stats);
            }

            return chainResults.sort((a, b) => b.total_transactions - a.total_transactions);
        } catch (error) {
            logger.error('[TransactionAnalyticsProvider] Error getting transaction counts by chain:', error);
            throw error;
        }
    }
} 