import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCChannelRepository } from '../../../services/ibc/repository/IBCChannelRepository';

export class IBCChannelController {
    private static channelRepository = new IBCChannelRepository();

    /**
     * Get channel by ID and port
     */
    public static async getChannel(req: Request, res: Response) {
        try {
            const { channelId, portId } = req.params;
            const network = req.network || Network.MAINNET;

            const channel = await IBCChannelController.channelRepository.getChannel(channelId, portId, network);

            if (!channel) {
                return res.status(404).json({ error: 'Channel not found' });
            }

            res.json(channel);
        } catch (error) {
            logger.error('Error getting channel:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get all channels
     */
    public static async getAllChannels(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;
            const state = req.query.state as string;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            let channels = await IBCChannelController.channelRepository.getAllChannels(network);
            
            // Filter by state if provided
            if (state) {
                channels = channels.filter(channel => channel.state === state);
            }
            
            const paginatedChannels = channels.slice(offset, offset + limit);

            res.json({
                channels: paginatedChannels,
                total: channels.length,
                limit,
                offset,
                ...(state && { filter: { state } })
            });
        } catch (error) {
            logger.error('Error getting all channels:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get channels by counterparty chain
     */
    public static async getChannelsByCounterparty(req: Request, res: Response) {
        try {
            const { chainId } = req.params;
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const channels = await IBCChannelController.channelRepository.getChannelsByCounterparty(chainId, network);
            
            const paginatedChannels = channels.slice(offset, offset + limit);

            res.json({
                channels: paginatedChannels,
                total: channels.length,
                limit,
                offset,
                counterparty_chain_id: chainId
            });
        } catch (error) {
            logger.error('Error getting channels by counterparty:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get channel statistics
     */
    public static async getChannelStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            
            const allChannels = await IBCChannelController.channelRepository.getAllChannels(network);
            
            // Group channels by state
            const stateCounts = allChannels.reduce((acc, channel) => {
                const state = channel.state || 'UNKNOWN';
                acc[state] = (acc[state] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            // Get unique counterparty chains
            const counterpartyChains = new Set(
                allChannels
                    .map(channel => channel.counterparty_chain_id)
                    .filter(chainId => chainId && chainId !== 'unknown')
            );

            res.json({
                total_channels: allChannels.length,
                by_state: stateCounts,
                connected_chains: counterpartyChains.size,
                counterparty_chains: Array.from(counterpartyChains),
                network: network.toString()
            });
        } catch (error) {
            logger.error('Error getting channel stats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get channel activity/metrics
     */
    public static async getChannelActivity(req: Request, res: Response) {
        try {
            const { channelId, portId } = req.params;
            const network = req.network || Network.MAINNET;

            const channel = await IBCChannelController.channelRepository.getChannel(channelId, portId, network);

            if (!channel) {
                return res.status(404).json({ error: 'Channel not found' });
            }

            // Extract activity metrics from channel data
            const activity = {
                channel_id: channelId,
                port_id: portId,
                state: channel.state,
                total_packets_sent: channel.total_packets_sent || 0,
                total_packets_received: channel.total_packets_received || 0,
                total_packets_acknowledged: channel.total_packets_acknowledged || 0,
                total_packets_timeout: channel.total_packets_timeout || 0,
                total_value_sent: channel.total_value_sent || '0',
                total_value_received: channel.total_value_received || '0',
                active_relayers: channel.active_relayers || 0,
                last_packet_time: channel.last_packet_time,
                created_at: channel.created_at,
                updated_at: channel.updated_at
            };

            res.json(activity);
        } catch (error) {
            logger.error('Error getting channel activity:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 