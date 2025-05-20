import mongoose from 'mongoose';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import IBCChannelModel from '../../../database/models/ibc/IBCChannel';
import IBCConnectionModel from '../../../database/models/ibc/IBCConnection';

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
     */
    public async getChannel(channelId: string, portId: string, network: Network): Promise<any> {
        try {
            return await IBCChannelModel.findOne({
                channel_id: channelId,
                port_id: portId,
                network: network.toString()
            });
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
                state: 'OPEN',
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
}
