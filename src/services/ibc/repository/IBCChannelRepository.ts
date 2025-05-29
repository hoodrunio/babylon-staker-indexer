import mongoose from 'mongoose';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import IBCChannelModel from '../../../database/models/ibc/IBCChannel';
import IBCConnectionModel from '../../../database/models/ibc/IBCConnection';
import { getChainName, formatChannelIdentifier } from '../constants/chainMapping';

/**
 * Repository for IBC Channel data
 * Following the Repository pattern to encapsulate data access logic
 */
export class IBCChannelRepository {
    /**
     * Create a new IBC channel
     * @param channelData Channel data to create
     * @param network Network for this channel
     */
    public async createChannel(channelData: any, network: Network): Promise<any> {
        try {
            const channelDoc = new IBCChannelModel({
                ...channelData,
                network: network.toString()
            });
            
            return await channelDoc.save();
        } catch (error: any) {
            // Check if it's a duplicate key error
            if (error.code === 11000) {
                logger.warn(`[IBCChannelRepository] Channel already exists: ${channelData.channel_id}`);
                // Update the existing channel instead
                return this.updateChannel(
                    channelData.channel_id,
                    channelData.port_id,
                    {
                        state: channelData.state,
                        counterparty_channel_id: channelData.counterparty_channel_id,
                        updated_at: channelData.updated_at
                    },
                    network
                );
            }
            
            logger.error(`[IBCChannelRepository] Error creating channel: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Update an existing IBC channel
     * @param channelId Channel ID to update
     * @param portId Port ID for the channel
     * @param updateData Data to update
     * @param network Network for this channel
     */
    public async updateChannel(
        channelId: string, 
        portId: string, 
        updateData: any,
        network: Network
    ): Promise<any> {
        try {
            return await IBCChannelModel.findOneAndUpdate(
                { 
                    channel_id: channelId, 
                    port_id: portId,
                    network: network.toString()
                },
                { $set: updateData },
                { new: true }
            );
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error updating channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get a channel by ID and port
     * @param channelId Channel ID to find
     * @param portId Port ID for the channel
     * @param network Network to query
     * @returns Channel with human-readable chain information
     */
    public async getChannel(channelId: string, portId: string, network: Network): Promise<any> {
        try {
            const channel = await IBCChannelModel.findOne({
                channel_id: channelId,
                port_id: portId,
                network: network.toString()
            });
            
            if (!channel) return null;
            
            // Add human-readable chain information
            let sourceChainId = 'bbn-1'; // Default to mainnet
            if (network === Network.TESTNET) {
                sourceChainId = 'bbn-test-5';
            }
            
            const destChainId = channel.counterparty_chain_id;
            
            return {
                ...channel.toObject(),
                source_chain_name: getChainName(sourceChainId),
                counterparty_chain_name: getChainName(destChainId),
                display_name: formatChannelIdentifier(
                    sourceChainId,
                    destChainId,
                    channel.channel_id
                )
            };
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error getting channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get all channels for a specific counterparty chain
     * @param counterpartyChainId Counterparty chain ID
     * @param network Network to query
     */
    public async getChannelsByCounterparty(counterpartyChainId: string, network: Network): Promise<any[]> {
        try {
            return await IBCChannelModel.find({
                counterparty_chain_id: counterpartyChainId,
                network: network.toString()
            });
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error getting channels for counterparty ${counterpartyChainId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get all open channels
     * @param network Network to query
     */
    public async getOpenChannels(network: Network): Promise<any[]> {
        try {
            return await IBCChannelModel.find({
                state: 'STATE_OPEN', // Fixed: Use actual DB state value
                network: network.toString()
            });
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error getting open channels: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get connection details - used to determine counterparty chain for a channel
     * @param connectionId Connection ID
     * @param network Network to query
     */
    public async getConnection(connectionId: string, network: Network): Promise<any> {
        try {
            return await IBCConnectionModel.findOne({
                connection_id: connectionId,
                network: network.toString()
            });
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error getting connection ${connectionId}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Get channel stats
     * @param channelId Channel ID
     * @param portId Port ID
     * @param network Network
     */
    public async getChannelStats(channelId: string, portId: string, network: Network): Promise<any> {
        try {
            const channel = await IBCChannelModel.findOne({
                channel_id: channelId,
                port_id: portId,
                network: network.toString()
            });
            
            if (!channel) {
                return {
                    packet_count: 0,
                    success_count: 0,
                    failure_count: 0,
                    timeout_count: 0,
                    success_rate: 0,
                    avg_completion_time_ms: 0
                };
            }
            
            // Calculate success rate
            const successRate = channel.packet_count > 0 
                ? (channel.success_count / channel.packet_count) * 100 
                : 0;
            
            return {
                packet_count: channel.packet_count || 0,
                success_count: channel.success_count || 0,
                failure_count: channel.failure_count || 0,
                timeout_count: channel.timeout_count || 0,
                success_rate: successRate,
                avg_completion_time_ms: channel.avg_completion_time_ms || 0
            };
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error getting channel stats: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get channels by activity (most active first)
     * @param limit Number of channels to return
     * @param network Network to query
     */
    public async getChannelsByActivity(limit: number, network: Network): Promise<any[]> {
        try {
            return await IBCChannelModel.find({
                network: network.toString()
            })
            .sort({ packet_count: -1 })
            .limit(limit);
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error getting active channels: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get channels by reliability (highest success rate first)
     * @param minPackets Minimum number of packets to consider
     * @param limit Number of channels to return
     * @param network Network to query
     */
    public async getChannelsByReliability(minPackets: number, limit: number, network: Network): Promise<any[]> {
        try {
            // First find channels with minimum packet count
            const channels = await IBCChannelModel.find({
                network: network.toString(),
                packet_count: { $gte: minPackets }
            });
            
            // Calculate success rate and sort
            return channels
                .map(channel => {
                    const successRate = channel.packet_count > 0 
                        ? (channel.success_count / channel.packet_count) * 100 
                        : 0;
                    return {
                        ...channel.toObject(),
                        success_rate: successRate
                    };
                })
                .sort((a, b) => b.success_rate - a.success_rate)
                .slice(0, limit);
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error getting reliable channels: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get all channels for a network
     * @param network Network to query
     * @returns Array of all channels with enhanced human-readable information
     */
    public async getAllChannels(network: Network): Promise<any[]> {
        try {
            const channels = await IBCChannelModel.find({
                network: network.toString()
            });
            
            // Enhance the channel data with human-readable chain information
            return channels.map(channel => {
                const sourceChainId = network === Network.MAINNET ? 'bbn-1' : 'bbn-test-5';
                const destChainId = channel.counterparty_chain_id;
                
                const sourceName = getChainName(sourceChainId);
                const destName = getChainName(destChainId);
                
                // Create a new object with both the original data and enhanced fields
                return {
                    ...channel.toObject(),
                    // Add human-readable fields
                    source_chain_name: sourceName,
                    counterparty_chain_name: destName,
                    display_name: formatChannelIdentifier(
                        sourceChainId,
                        destChainId,
                        channel.channel_id
                    )
                };
            });
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error getting all channels: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Save or update a channel
     * @param channelData Channel data to save
     * @param network Network for this channel
     * @returns The saved channel document
     */
    public async saveChannel(channelData: any, network: Network): Promise<any> {
        try {
            return await IBCChannelModel.findOneAndUpdate(
                { 
                    channel_id: channelData.channel_id,
                    port_id: channelData.port_id,
                    network: network.toString() 
                },
                { ...channelData, network: network.toString(), updated_at: new Date() },
                { upsert: true, new: true }
            );
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error saving channel: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Update packet statistics for a channel
     * @param channelId Channel ID
     * @param portId Port ID
     * @param packetData Packet data containing success/failure info
     * @param network Network
     */
    public async updatePacketStats(
        channelId: string, 
        portId: string, 
        packetData: {
            success: boolean;
            timeout: boolean;
            completionTimeMs?: number;
            tokenAmount?: string;
            tokenDenom?: string;
            relayerAddress?: string;
            direction?: 'incoming' | 'outgoing'; // New field for transfer direction
        },
        network: Network
    ): Promise<void> {
        try {
            const updateOps: any = {
                $inc: {
                    packet_count: 1
                },
                $set: {
                    updated_at: new Date()
                }
            };

            // Update success/failure counters
            if (packetData.timeout) {
                updateOps.$inc.timeout_count = 1;
            } else if (packetData.success) {
                updateOps.$inc.success_count = 1;
            } else {
                updateOps.$inc.failure_count = 1;
            }

            // Update completion time average
            if (packetData.completionTimeMs && packetData.completionTimeMs > 0) {
                const channel = await IBCChannelModel.findOne({
                    channel_id: channelId,
                    port_id: portId,
                    network: network.toString()
                });

                if (channel) {
                    const currentAvg = channel.avg_completion_time_ms || 0;
                    const currentCount = channel.packet_count || 0;
                    const newAvg = ((currentAvg * currentCount) + packetData.completionTimeMs) / (currentCount + 1);
                    updateOps.$set.avg_completion_time_ms = newAvg;
                }
            }

            // Update token transfer totals with direction
            if (packetData.tokenAmount && packetData.tokenDenom && packetData.direction) {
                const amount = parseInt(packetData.tokenAmount);
                if (!isNaN(amount) && amount > 0) {
                    const directionKey = packetData.direction === 'incoming' ? 'incoming' : 'outgoing';
                    const tokenKey = `total_tokens_transferred.${directionKey}.${packetData.tokenDenom}`;
                    updateOps.$inc = updateOps.$inc || {};
                    updateOps.$inc[tokenKey] = amount;
                }
            }

            // Update active relayers list
            if (packetData.relayerAddress) {
                updateOps.$addToSet = {
                    active_relayers: packetData.relayerAddress
                };
            }

            await IBCChannelModel.updateOne(
                {
                    channel_id: channelId,
                    port_id: portId,
                    network: network.toString()
                },
                updateOps,
                { upsert: false }
            );

            logger.debug(`[IBCChannelRepository] Updated packet stats for channel ${channelId} (${packetData.direction || 'unknown direction'})`);
        } catch (error) {
            logger.error(`[IBCChannelRepository] Error updating packet stats: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
