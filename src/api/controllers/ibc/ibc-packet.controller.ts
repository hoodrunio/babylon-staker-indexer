import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCPacketRepository } from '../../../services/ibc/repository/IBCPacketRepository';
import { IBCPacket } from '../../../database/models/ibc/IBCPacket';


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
                    startDate = new Date(now);
                    startDate.setUTCHours(now.getUTCHours() - 1);
                    break;
                case '24h':
                    startDate = new Date(now);
                    startDate.setUTCDate(now.getUTCDate() - 1);
                    break;
                case '7d':
                    startDate = new Date(now);
                    startDate.setUTCDate(now.getUTCDate() - 7);
                    break;
                case '30d':
                    startDate = new Date(now);
                    startDate.setUTCDate(now.getUTCDate() - 30);
                    break;
                default:
                    startDate = new Date(now);
                    startDate.setUTCDate(now.getUTCDate() - 1);
            }

            // Get all packets within date range
            const packetsInPeriod = await IBCPacketController.packetRepository.getPacketsInPeriod(
                startDate,
                now,
                network
            );

            // Calculate packet statistics
            const totalPackets = packetsInPeriod.length;
            
            // Count packets by status
            const packetsByStatus = packetsInPeriod.reduce((acc: Record<string, number>, packet: IBCPacket) => {
                const status = packet.status || 'unknown';
                acc[status] = (acc[status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            
            // Count packets by channel
            const packetsByChannel = packetsInPeriod.reduce((acc: Record<string, number>, packet: IBCPacket) => {
                const channelKey = `${packet.source_channel}`;
                acc[channelKey] = (acc[channelKey] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            
            // Calculate average completion time (for ACKNOWLEDGED packets only)
            // RECEIVED packets are excluded as we don't know when they started from the other network
            const completedPackets = packetsInPeriod.filter(
                (packet: IBCPacket) => 
                    packet.status === 'ACKNOWLEDGED' && 
                    packet.send_time && 
                    packet.completion_time_ms
            );
            
            let avgCompletionTimeMs = 0;
            if (completedPackets.length > 0) {
                // Calculate average of the already computed completion_time_ms values
                const totalCompletionTime = completedPackets.reduce((total: number, packet: IBCPacket) => {
                    return total + (packet.completion_time_ms || 0);
                }, 0);
                
                avgCompletionTimeMs = Math.round(totalCompletionTime / completedPackets.length);
            }
            
            // Calculate success rate (ACKNOWLEDGED or COMPLETED are considered successful)
            const successfulPackets = packetsInPeriod.filter(
                (packet: IBCPacket) => packet.status === 'ACKNOWLEDGED' || packet.status === 'COMPLETED'
            ).length;
            
            const successRate = totalPackets > 0 
                ? Math.round((successfulPackets / totalPackets) * 10000) / 100 
                : 0;
                
            // Calculate time-based distribution (packets per hour)
            const hourlyDistribution = Array(period === '1h' ? 12 : 24).fill(0);
            
            packetsInPeriod.forEach((packet: IBCPacket) => {
                if (packet.send_time) {
                    const sendTime = new Date(packet.send_time);
                    if (period === '1h') {
                        const minuteIndex = Math.floor(sendTime.getUTCMinutes() / 5); // For 1h period, group by 5-minute intervals
                        if (minuteIndex >= 0 && minuteIndex < 12) {
                            hourlyDistribution[minuteIndex]++;
                        }
                    } else {
                        const hourIndex = sendTime.getUTCHours(); // Use UTC hours for consistency
                        if (hourIndex >= 0 && hourIndex < 24) {
                            hourlyDistribution[hourIndex]++;
                        }
                    }
                }
            });
            
            // Format hourly distribution with time labels
            const formattedHourlyDistribution = [];
            
            if (period === '1h') {
                // For 1h, create 5-minute interval labels
                for (let i = 0; i < 12; i++) {
                    const startMinute = i * 5;
                    const endMinute = startMinute + 4;
                    const timeLabel = `${startMinute.toString().padStart(2, '0')}:00-${endMinute.toString().padStart(2, '0')}:59`;
                    
                    formattedHourlyDistribution.push({
                        time_label: timeLabel,
                        count: hourlyDistribution[i]
                    });
                }
            } else {
                // For other periods, create hourly labels
                for (let i = 0; i < 24; i++) {
                    const hourLabel = `${i.toString().padStart(2, '0')}:00-${i.toString().padStart(2, '0')}:59 UTC`;
                    
                    formattedHourlyDistribution.push({
                        time_label: hourLabel,
                        count: hourlyDistribution[i]
                    });
                }
            }
            
            // Calculate top relayers
            const relayerCounts = packetsInPeriod.reduce((acc: Record<string, number>, packet: IBCPacket) => {
                if (packet.relayer_address) {
                    acc[packet.relayer_address] = (acc[packet.relayer_address] || 0) + 1;
                }
                return acc;
            }, {} as Record<string, number>);
            
            interface RelayerCount {
                address: string;
                count: number;
            }
            
            const topRelayers = Object.entries(relayerCounts)
                .map(([address, count]) => ({ address, count: count as number }))
                .sort((a: RelayerCount, b: RelayerCount) => b.count - a.count)
                .slice(0, 5);

            res.json({
                period,
                network: network.toString(),
                date_range: {
                    start: startDate.toISOString(),
                    end: now.toISOString()
                },
                total_packets: totalPackets,
                packets_by_status: packetsByStatus,
                packets_by_channel: packetsByChannel,
                avg_completion_time_ms: avgCompletionTimeMs,
                success_rate: successRate,
                hourly_distribution: formattedHourlyDistribution,
                top_relayers: topRelayers
            });
        } catch (error) {
            logger.error('Error getting packet stats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 