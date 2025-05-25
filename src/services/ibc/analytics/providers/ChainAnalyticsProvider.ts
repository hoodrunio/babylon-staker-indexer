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
import { IBCClientRepository } from '../../repository/IBCClientRepository';
import { getChainName } from '../../constants/chainMapping';
import { getTokenService } from '../domain/TokenServiceFactory';
import { ITokenService } from '../domain/TokenService';
import { ChainConfigService } from '../config/ChainConfigService';
import IBCTransferModel from '../../../../database/models/ibc/IBCTransfer';

/**
 * Chain Analytics Provider - follows SRP by handling only chain-related analytics
 */
export class ChainAnalyticsProvider implements IChainAnalyticsProvider {
    private readonly tokenService: ITokenService;
    private readonly chainConfig: ChainConfigService;

    constructor(
        private readonly channelRepository: IBCChannelRepository,
        private readonly connectionRepository: IBCConnectionRepository,
        private readonly transferRepository: IBCTransferRepository,
        private readonly clientRepository: IBCClientRepository
    ) {
        this.tokenService = getTokenService();
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

            // Process channels and resolve chain IDs from connections/clients
            for (const channel of channels) {
                let chainId = '';
                
                try {
                    // Get connection to find client
                    const connection = await this.connectionRepository.getConnection(channel.connection_id, network);
                    if (connection && connection.client_id) {
                        // Get client to find chain_id
                        const client = await this.clientRepository.getClient(connection.client_id, network);
                        if (client && client.chain_id) {
                            chainId = client.chain_id;
                        }
                    }
                } catch (error) {
                    logger.debug(`[ChainAnalyticsProvider] Could not resolve chain for channel ${channel.channel_id}: ${error}`);
                }
                
                if (!chainId || chainId === 'unknown' || this.chainConfig.isHomeChain(chainId, network)) {
                    continue;
                }

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
            }

            // Count connections per chain
            for (const connection of connections) {
                let chainId = '';
                
                try {
                    // Get client to find chain_id
                    const client = await this.clientRepository.getClient(connection.client_id, network);
                    if (client && client.chain_id) {
                        chainId = client.chain_id;
                    }
                } catch (error) {
                    logger.debug(`[ChainAnalyticsProvider] Could not resolve chain for connection ${connection.connection_id}: ${error}`);
                }
                
                if (chainsMap.has(chainId)) {
                    chainsMap.get(chainId)!.connection_count++;
                }
            }

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
     * Now uses channel data and SOLID-compliant TokenService for volume calculations
     */
    async getChainVolumes(network: Network): Promise<ChainVolumeResult[]> {
        try {
            logger.info(`[ChainAnalyticsProvider] Getting chain volumes for network: ${network}`);

            const channels = await this.channelRepository.getAllChannels(network);
            
            // Group volumes by chain using channel data
            const chainVolumesMap = new Map<string, {
                incoming: Record<string, number>;
                outgoing: Record<string, number>;
            }>();

            for (const channel of channels) {
                // Get chain ID from connection/client
                let chainId = '';
                try {
                    const connection = await this.connectionRepository.getConnection(channel.connection_id, network);
                    if (connection && connection.client_id) {
                        const client = await this.clientRepository.getClient(connection.client_id, network);
                        if (client && client.chain_id) {
                            chainId = client.chain_id;
                        }
                    }
                } catch (error) {
                    logger.debug(`[ChainAnalyticsProvider] Could not resolve chain for channel ${channel.channel_id}: ${error}`);
                    continue;
                }

                // Skip home chain and unknown chains
                if (!chainId || this.chainConfig.isHomeChain(chainId, network)) continue;

                // Initialize chain data if not exists
                if (!chainVolumesMap.has(chainId)) {
                    chainVolumesMap.set(chainId, { incoming: {}, outgoing: {} });
                }

                const chainData = chainVolumesMap.get(chainId)!;

                // Process channel's total_tokens_transferred data
                if (channel.total_tokens_transferred) {
                    // Process incoming volumes (from counterparty chain perspective, this is outgoing)
                    if (channel.total_tokens_transferred.incoming) {
                        const incomingMap = channel.total_tokens_transferred.incoming instanceof Map 
                            ? channel.total_tokens_transferred.incoming 
                            : new Map(Object.entries(channel.total_tokens_transferred.incoming || {}));
                        
                        incomingMap.forEach((amount: number, denom: string) => {
                            chainData.outgoing[denom] = (chainData.outgoing[denom] || 0) + amount;
                        });
                    }
                    
                    // Process outgoing volumes (from counterparty chain perspective, this is incoming)
                    if (channel.total_tokens_transferred.outgoing) {
                        const outgoingMap = channel.total_tokens_transferred.outgoing instanceof Map 
                            ? channel.total_tokens_transferred.outgoing 
                            : new Map(Object.entries(channel.total_tokens_transferred.outgoing || {}));
                        
                        outgoingMap.forEach((amount: number, denom: string) => {
                            chainData.incoming[denom] = (chainData.incoming[denom] || 0) + amount;
                        });
                    }
                }
            }

            // Convert to result format using TokenService
            const chainVolumes: ChainVolumeResult[] = [];
            
            for (const [chainId, volumes] of chainVolumesMap.entries()) {
                const volumes_by_denom: Record<string, string> = {};

                // Prepare denomination amounts for batch conversion
                const incomingAmounts: Array<{ denom: string; amount: number }> = [];
                const outgoingAmounts: Array<{ denom: string; amount: number }> = [];

                // Combine incoming and outgoing volumes
                Object.entries(volumes.incoming).forEach(([denom, amount]) => {
                    volumes_by_denom[denom] = (parseFloat(volumes_by_denom[denom] || '0') + amount).toString();
                    incomingAmounts.push({ denom, amount });
                });

                Object.entries(volumes.outgoing).forEach(([denom, amount]) => {
                    volumes_by_denom[denom] = (parseFloat(volumes_by_denom[denom] || '0') + amount).toString();
                    outgoingAmounts.push({ denom, amount });
                });

                // Use TokenService for USD conversion - much cleaner!
                const [incomingResult, outgoingResult] = await Promise.all([
                    this.tokenService.convertBatchToUsd(incomingAmounts),
                    this.tokenService.convertBatchToUsd(outgoingAmounts)
                ]);

                chainVolumes.push({
                    chain_id: chainId,
                    chain_name: getChainName(chainId),
                    total_volume_usd: (incomingResult.total + outgoingResult.total).toString(),
                    volumes_by_denom,
                    incoming_volume: incomingResult.total.toString(),
                    outgoing_volume: outgoingResult.total.toString()
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

} 