import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import IBCRelayer from '../../../database/models/ibc/IBCRelayer';
import { RelayerVolumeService } from '../relayer/RelayerVolumeService';

/**
 * Repository for managing IBC relayer data
 * Now includes volume tracking capabilities following SOLID principles
 */
export class IBCRelayerRepository {
    private readonly volumeService: RelayerVolumeService;

    constructor() {
        this.volumeService = new RelayerVolumeService();
    }
    /**
     * Track relayer activity and update statistics
     * Now includes volume tracking for successful transfers
     */
    public async trackRelayerActivity(relayerData: any, network: Network): Promise<any> {
        try {
            logger.debug(`[IBCRelayerRepository] Track relayer activity for network ${network}: ${JSON.stringify(relayerData)}`);
            
            // Find or create the relayer record
            const relayer = await IBCRelayer.findOneAndUpdate(
                { 
                    address: relayerData.address,
                    network: network.toString()
                },
                {
                    $setOnInsert: {
                        first_seen_at: new Date(),
                        chains_served: [],
                        active_channels: []
                    },
                    $set: {
                        last_active_at: new Date()
                    },
                    $inc: {
                        total_packets_relayed: 1
                    }
                },
                { upsert: true, new: true }
            );

            // Update successful/failed packet counts
            if (relayerData.success) {
                await IBCRelayer.updateOne(
                    { address: relayerData.address, network: network.toString() },
                    { $inc: { successful_packets: 1 } }
                );
            } else {
                await IBCRelayer.updateOne(
                    { address: relayerData.address, network: network.toString() },
                    { $inc: { failed_packets: 1 } }
                );
            }

            // Update relay time if we have timing data
            if (relayerData.relay_time_ms) {
                // We calculate a running average for relay time
                await this.updateRelayerAvgTime(relayerData.address, relayerData.relay_time_ms, network);
            }

            // Update channel stats
            if (relayerData.channel_id && relayerData.port_id) {
                await this.updateRelayerChannelStats(
                    relayerData.address,
                    relayerData.channel_id,
                    relayerData.port_id,
                    network
                );
            }

            // Update chains served
            if (relayerData.source_chain_id && relayerData.destination_chain_id) {
                await this.updateRelayerChains(
                    relayerData.address,
                    [relayerData.source_chain_id, relayerData.destination_chain_id],
                    network
                );
            }

            // NEW: Track volume for successful transfers
            if (relayerData.success && relayerData.transfer_data) {
                await this.updateRelayerVolume(
                    relayerData.address,
                    relayerData.transfer_data,
                    relayerData.source_chain_id,
                    relayerData.destination_chain_id,
                    relayerData.channel_id,
                    relayerData.port_id,
                    network
                );
            }

            return relayer;
        } catch (error) {
            logger.error(`[IBCRelayerRepository] Error tracking relayer activity: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Update the average relay time for a relayer
     */
    private async updateRelayerAvgTime(address: string, relayTimeMs: number, network: Network): Promise<void> {
        try {
            const relayer = await IBCRelayer.findOne({ address, network: network.toString() });
            if (!relayer) return;

            // Calculate new average based on current average and new value
            const currentTotal = relayer.avg_relay_time_ms * relayer.total_packets_relayed;
            const newTotal = currentTotal + relayTimeMs;
            const newAvg = newTotal / (relayer.total_packets_relayed);

            await IBCRelayer.updateOne(
                { address, network: network.toString() },
                { $set: { avg_relay_time_ms: newAvg } }
            );
        } catch (error) {
            logger.error(`[IBCRelayerRepository] Error updating relayer avg time: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Update the channel stats for a relayer
     */
    private async updateRelayerChannelStats(
        address: string, 
        channelId: string, 
        portId: string,
        network: Network
    ): Promise<void> {
        try {
            // Check if the channel already exists in the relayer's active channels
            const relayer = await IBCRelayer.findOne({ 
                address, 
                network: network.toString(),
                'active_channels.channel_id': channelId,
                'active_channels.port_id': portId
            });

            if (relayer) {
                // Update the existing channel count
                await IBCRelayer.updateOne(
                    {
                        address,
                        network: network.toString(),
                        'active_channels.channel_id': channelId,
                        'active_channels.port_id': portId
                    },
                    { $inc: { 'active_channels.$.count': 1 } }
                );
            } else {
                // Add the new channel to the array
                await IBCRelayer.updateOne(
                    { address, network: network.toString() },
                    { 
                        $push: { 
                            active_channels: {
                                channel_id: channelId,
                                port_id: portId,
                                count: 1
                            }
                        }
                    }
                );
            }
        } catch (error) {
            logger.error(`[IBCRelayerRepository] Error updating relayer channel stats: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Update the chains served by a relayer
     */
    private async updateRelayerChains(address: string, chains: string[], network: Network): Promise<void> {
        try {
            // Add chains to the relayer's chains_served array if they don't already exist
            await IBCRelayer.updateOne(
                { address, network: network.toString() },
                { $addToSet: { chains_served: { $each: chains } } }
            );
        } catch (error) {
            logger.error(`[IBCRelayerRepository] Error updating relayer chains: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Update volume data for a relayer - REFACTORED: Only native amounts
     */
    private async updateRelayerVolume(
        address: string,
        transferData: { denom: string; amount: string },
        sourceChainId: string,
        destChainId: string,
        channelId: string,
        portId: string,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCRelayerRepository] Updating volume for relayer ${address}: ${transferData.amount} ${transferData.denom}`);

            // Prepare update operations for native amounts only
            const updateOps = this.volumeService.prepareVolumeUpdateOperations(
                transferData,
                sourceChainId,
                destChainId,
                channelId,
                portId
            );

            // Apply denomination volume update
            await IBCRelayer.updateOne(
                { address, network: network.toString() },
                updateOps.denomVolumeUpdate
            );

            // Apply chain volume updates (separate operations for nested Maps)
            for (const chainUpdate of updateOps.chainVolumeUpdates) {
                await IBCRelayer.updateOne(
                    { address, network: network.toString() },
                    chainUpdate
                );
            }

            // Update channel-specific volume if channel exists
            const channelExists = await IBCRelayer.findOne({
                address,
                network: network.toString(),
                'active_channels.channel_id': channelId,
                'active_channels.port_id': portId
            });

            if (channelExists) {
                await IBCRelayer.updateOne(
                    {
                        address,
                        network: network.toString(),
                        'active_channels.channel_id': channelId,
                        'active_channels.port_id': portId
                    },
                    updateOps.channelVolumeUpdate
                );
            }

            logger.debug(`[IBCRelayerRepository] Successfully updated native volume for relayer ${address}: +${transferData.amount} ${transferData.denom}`);
        } catch (error) {
            logger.error(`[IBCRelayerRepository] Error updating relayer volume: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get a relayer by address
     */
    public async getRelayer(address: string, network: Network): Promise<any> {
        try {
            logger.debug(`[IBCRelayerRepository] Get relayer ${address} for network ${network}`);
            return await IBCRelayer.findOne({ address, network: network.toString() });
        } catch (error) {
            logger.error(`[IBCRelayerRepository] Error getting relayer: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Get top relayers by number of packets relayed
     */
    public async getTopRelayers(limit: number, network: Network): Promise<any[]> {
        try {
            return await IBCRelayer.find({ network: network.toString() })
                .sort({ total_packets_relayed: -1 })
                .limit(limit);
        } catch (error) {
            logger.error(`[IBCRelayerRepository] Error getting top relayers: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Get relayers active on a specific chain
     */
    public async getRelayersByChain(chainId: string, network: Network): Promise<any[]> {
        try {
            return await IBCRelayer.find({
                chains_served: chainId,
                network: network.toString()
            });
        } catch (error) {
            logger.error(`[IBCRelayerRepository] Error getting relayers by chain: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
}

