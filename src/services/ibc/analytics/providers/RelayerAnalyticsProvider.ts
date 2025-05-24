import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';
import {
    IRelayerAnalyticsProvider,
    RelayerByChainResult,
    RelayerVolumeResult,
    RelayerTransactionCountResult
} from '../../interfaces/IBCAnalyticsService';
import { IBCRelayerRepository } from '../../repository/IBCRelayerRepository';
import { getChainName } from '../../constants/chainMapping';
import IBCRelayerModel from '../../../../database/models/ibc/IBCRelayer';
import IBCPacketModel from '../../../../database/models/ibc/IBCPacket';
import IBCTransferModel from '../../../../database/models/ibc/IBCTransfer';

/**
 * Relayer Analytics Provider - follows SRP by handling only relayer-related analytics
 * Implements DIP by depending on repository abstractions
 */
export class RelayerAnalyticsProvider implements IRelayerAnalyticsProvider {
    constructor(
        private readonly relayerRepository: IBCRelayerRepository
    ) {}

    /**
     * Get relayers grouped by the chains they serve
     */
    async getRelayersByChain(network: Network): Promise<RelayerByChainResult[]> {
        try {
            logger.info(`[RelayerAnalyticsProvider] Getting relayers by chain for network: ${network}`);

            const relayers = await IBCRelayerModel.find({
                network: network.toString()
            });

            // Group relayers by chains they serve
            const chainRelayersMap = new Map<string, Set<string>>();

            relayers.forEach(relayer => {
                relayer.chains_served.forEach(chainId => {
                    if (chainId === 'babylonchain') return; // Skip our own chain
                    
                    if (!chainRelayersMap.has(chainId)) {
                        chainRelayersMap.set(chainId, new Set());
                    }
                    
                    chainRelayersMap.get(chainId)!.add(relayer.address);
                });
            });

            // Convert to result format
            const results: RelayerByChainResult[] = [];
            
            for (const [chainId, relayerAddresses] of chainRelayersMap.entries()) {
                results.push({
                    chain_id: chainId,
                    chain_name: getChainName(chainId),
                    relayer_addresses: Array.from(relayerAddresses),
                    active_relayer_count: relayerAddresses.size
                });
            }

            return results.sort((a, b) => b.active_relayer_count - a.active_relayer_count);
        } catch (error) {
            logger.error('[RelayerAnalyticsProvider] Error getting relayers by chain:', error);
            throw error;
        }
    }

    /**
     * Get volume statistics for each relayer
     */
    async getRelayerVolumes(network: Network): Promise<RelayerVolumeResult[]> {
        try {
            logger.info(`[RelayerAnalyticsProvider] Getting relayer volumes for network: ${network}`);

            // Get all packets with relayer information
            const packets = await IBCPacketModel.find({
                network: network.toString(),
                relayer_address: { $exists: true, $ne: null }
            });

            // Group by relayer address
            const relayerVolumeMap = new Map<string, {
                chains: Set<string>;
                total_packets: number;
                successful_packets: number;
                volume_by_chain: Map<string, number>;
            }>();

            // Process each packet to get associated transfers
            for (const packet of packets) {
                const relayerAddress = packet.relayer_address;
                if (!relayerAddress) continue;

                const sourceChain = packet.source_chain_id;
                const destChain = packet.destination_chain_id;
                
                if (!relayerVolumeMap.has(relayerAddress)) {
                    relayerVolumeMap.set(relayerAddress, {
                        chains: new Set(),
                        total_packets: 0,
                        successful_packets: 0,
                        volume_by_chain: new Map()
                    });
                }

                const relayerData = relayerVolumeMap.get(relayerAddress)!;
                relayerData.chains.add(sourceChain);
                relayerData.chains.add(destChain);
                relayerData.total_packets++;

                if (packet.status === 'ACKNOWLEDGED') {
                    relayerData.successful_packets++;
                }

                // Get transfer value for this packet
                const transfer = await IBCTransferModel.findOne({
                    packet_id: packet._id,
                    network: network.toString()
                });

                if (transfer && transfer.success) {
                    const amount = parseFloat(transfer.amount);
                    const volumeUSD = this.convertToUSD(transfer.denom, amount);
                    
                    // Add to source chain volume
                    const sourceVolume = relayerData.volume_by_chain.get(sourceChain) || 0;
                    relayerData.volume_by_chain.set(sourceChain, sourceVolume + volumeUSD);
                    
                    // Add to destination chain volume
                    const destVolume = relayerData.volume_by_chain.get(destChain) || 0;
                    relayerData.volume_by_chain.set(destChain, destVolume + volumeUSD);
                }
            }

            // Convert to result format
            const results: RelayerVolumeResult[] = [];
            
            for (const [relayerAddress, data] of relayerVolumeMap.entries()) {
                const volumes_by_chain: Record<string, string> = {};
                let total_volume_usd = 0;

                for (const [chainId, volume] of data.volume_by_chain.entries()) {
                    volumes_by_chain[chainId] = volume.toString();
                    total_volume_usd += volume;
                }

                const success_rate = data.total_packets > 0 ? 
                    (data.successful_packets / data.total_packets) * 100 : 0;

                results.push({
                    relayer_address: relayerAddress,
                    total_volume_usd: total_volume_usd.toString(),
                    volumes_by_chain,
                    total_packets_relayed: data.total_packets,
                    success_rate: Math.round(success_rate * 100) / 100
                });
            }

            return results.sort((a, b) => 
                parseFloat(b.total_volume_usd) - parseFloat(a.total_volume_usd)
            );
        } catch (error) {
            logger.error('[RelayerAnalyticsProvider] Error getting relayer volumes:', error);
            throw error;
        }
    }

    /**
     * Get transaction count statistics for each relayer
     */
    async getRelayerTransactionCounts(network: Network): Promise<RelayerTransactionCountResult[]> {
        try {
            logger.info(`[RelayerAnalyticsProvider] Getting relayer transaction counts for network: ${network}`);

            // Aggregate relayer statistics from packets
            const pipeline = [
                {
                    $match: {
                        network: network.toString(),
                        relayer_address: { $exists: true, $ne: null }
                    }
                },
                {
                    $group: {
                        _id: '$relayer_address',
                        total_transactions: { $sum: 1 },
                        successful_transactions: {
                            $sum: { $cond: [{ $eq: ['$status', 'ACKNOWLEDGED'] }, 1, 0] }
                        },
                        completion_times: {
                            $push: { $ifNull: ['$completion_time_ms', null] }
                        }
                    }
                },
                {
                    $project: {
                        relayer_address: '$_id',
                        total_transactions: 1,
                        successful_transactions: 1,
                        failed_transactions: { $subtract: ['$total_transactions', '$successful_transactions'] },
                        success_rate: {
                            $multiply: [
                                { $divide: ['$successful_transactions', '$total_transactions'] },
                                100
                            ]
                        },
                        avg_completion_time_ms: {
                            $avg: {
                                $filter: {
                                    input: '$completion_times',
                                    cond: { $ne: ['$$this', null] }
                                }
                            }
                        }
                    }
                }
            ];

            const aggregationResult = await IBCPacketModel.aggregate(pipeline);

            const results: RelayerTransactionCountResult[] = aggregationResult.map(result => ({
                relayer_address: result._id,
                total_transactions: result.total_transactions,
                successful_transactions: result.successful_transactions,
                failed_transactions: result.failed_transactions,
                success_rate: Math.round((result.success_rate || 0) * 100) / 100,
                avg_completion_time_ms: Math.round(result.avg_completion_time_ms || 0)
            }));

            return results.sort((a, b) => b.total_transactions - a.total_transactions);
        } catch (error) {
            logger.error('[RelayerAnalyticsProvider] Error getting relayer transaction counts:', error);
            throw error;
        }
    }

    /**
     * Helper method to convert denomination amounts to USD
     */
    private convertToUSD(denom: string, amount: number): number {
        // Simplified price conversion - in real implementation would use price oracle
        const denomPrices: Record<string, number> = {
            'ubbn': 0.000001,
            'uatom': 0.000001,
            'uosmo': 0.000001,
            'ustars': 0.000001,
            'ujuno': 0.000001
        };

        return amount * (denomPrices[denom] || 0);
    }
} 