import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCPacketRepository } from '../../../services/ibc/repository/IBCPacketRepository';

export class IBCPacketController {
    private static packetRepository = new IBCPacketRepository();

    /**
     * Get packet by source channel, port and sequence
     */
    public static async getPacket(req: Request, res: Response) {
        try {
            const { sourcePort, sourceChannel, sequence } = req.params;
            const network = req.network || Network.MAINNET;

            const packet = await IBCPacketController.packetRepository.getPacket(
                sourcePort,
                sourceChannel,
                parseInt(sequence),
                network
            );

            if (!packet) {
                return res.status(404).json({ error: 'Packet not found' });
            }

            res.json(packet);
        } catch (error) {
            logger.error('Error getting packet:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get packets by channel
     */
    public static async getPacketsByChannel(req: Request, res: Response) {
        try {
            const { channelId, portId } = req.params;
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;
            const status = req.query.status as string;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const packets = await IBCPacketController.packetRepository.getPacketsByChannel(
                channelId,
                portId,
                network
            );

            // Filter by status if provided
            let filteredPackets = packets;
            if (status) {
                filteredPackets = packets.filter(packet => packet.status === status);
            }

            const paginatedPackets = filteredPackets.slice(offset, offset + limit);

            res.json({
                packets: paginatedPackets,
                total: filteredPackets.length,
                limit,
                offset,
                channel_id: channelId,
                port_id: portId,
                ...(status && { filter: { status } })
            });
        } catch (error) {
            logger.error('Error getting packets by channel:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get packets by relayer
     */
    public static async getPacketsByRelayer(req: Request, res: Response) {
        try {
            const { relayerAddress } = req.params;
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const packets = await IBCPacketController.packetRepository.getPacketsByRelayer(relayerAddress, network);
            
            const paginatedPackets = packets.slice(offset, offset + limit);

            res.json({
                packets: paginatedPackets,
                total: packets.length,
                limit,
                offset,
                relayer_address: relayerAddress
            });
        } catch (error) {
            logger.error('Error getting packets by relayer:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get packet statistics
     */
    public static async getPacketStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            const period = req.query.period as string || '24h';

            // Calculate date range based on period
            const now = new Date();
            let startDate = new Date();
            
            switch (period) {
                case '1h':
                    startDate.setHours(now.getHours() - 1);
                    break;
                case '24h':
                    startDate.setDate(now.getDate() - 1);
                    break;
                case '7d':
                    startDate.setDate(now.getDate() - 7);
                    break;
                case '30d':
                    startDate.setDate(now.getDate() - 30);
                    break;
                default:
                    startDate.setDate(now.getDate() - 1);
            }

            // This would need to be implemented in the repository
            // For now, return a basic response
            res.json({
                period,
                network: network.toString(),
                message: 'Packet statistics endpoint - implementation pending'
            });
        } catch (error) {
            logger.error('Error getting packet stats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 