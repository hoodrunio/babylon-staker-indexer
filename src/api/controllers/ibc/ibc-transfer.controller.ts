import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCTransferRepository } from '../../../services/ibc/repository/IBCTransferRepository';
import mongoose from 'mongoose';
import { IBCTransfer } from '../../../database/models/ibc/IBCTransfer';

export class IBCTransferController {
    private static transferRepository = new IBCTransferRepository();

    /**
     * Get transfer by ID
     */
    public static async getTransferById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const network = req.network || Network.MAINNET;

            if (!mongoose.Types.ObjectId.isValid(id)) {
                return res.status(400).json({ error: 'Invalid transfer ID format' });
            }

            const transfer = await IBCTransferController.transferRepository.getTransferByPacketId(
                new mongoose.Types.ObjectId(id),
                network
            );

            if (!transfer) {
                return res.status(404).json({ error: 'Transfer not found' });
            }

            res.json(transfer);
        } catch (error) {
            logger.error('Error getting transfer by ID:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get transfer by transaction hash
     */
    public static async getTransferByTxHash(req: Request, res: Response) {
        try {
            const { txHash } = req.params;
            const network = req.network || Network.MAINNET;

            const transfer = await IBCTransferController.transferRepository.getTransferByTxHash(txHash, network);

            if (!transfer) {
                return res.status(404).json({ error: 'Transfer not found' });
            }

            res.json(transfer);
        } catch (error) {
            logger.error('Error getting transfer by tx hash:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get transfers by sender address
     */
    public static async getTransfersBySender(req: Request, res: Response) {
        try {
            const { address } = req.params;
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const transfers = await IBCTransferController.transferRepository.getTransfersBySender(address, network);
            
            const paginatedTransfers = transfers.slice(offset, offset + limit);

            res.json({
                transfers: paginatedTransfers,
                total: transfers.length,
                limit,
                offset
            });
        } catch (error) {
            logger.error('Error getting transfers by sender:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get transfers by receiver address
     */
    public static async getTransfersByReceiver(req: Request, res: Response) {
        try {
            const { address } = req.params;
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const transfers = await IBCTransferController.transferRepository.getTransfersByReceiver(address, network);
            
            const paginatedTransfers = transfers.slice(offset, offset + limit);

            res.json({
                transfers: paginatedTransfers,
                total: transfers.length,
                limit,
                offset
            });
        } catch (error) {
            logger.error('Error getting transfers by receiver:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get transfers between specific chains
     */
    public static async getTransfersByChains(req: Request, res: Response) {
        try {
            const { sourceChain, destChain } = req.params;
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const transfers = await IBCTransferController.transferRepository.getTransfersByChains(
                sourceChain,
                destChain,
                network
            );
            
            const paginatedTransfers = transfers.slice(offset, offset + limit);

            res.json({
                transfers: paginatedTransfers,
                total: transfers.length,
                limit,
                offset,
                source_chain: sourceChain,
                destination_chain: destChain
            });
        } catch (error) {
            logger.error('Error getting transfers by chains:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get transfer statistics
     */
    public static async getTransferStats(req: Request, res: Response) {
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

            // Get transfers within date range
            const transfers = await IBCTransferController.transferRepository.getTransfersInPeriod(
                startDate,
                now,
                network
            );

            // Calculate transfer statistics
            const totalTransfers = transfers.length;
            
            // Count transfers by status
            const transfersByStatus = transfers.reduce((acc: Record<string, number>, transfer: IBCTransfer) => {
                const status = transfer.success ? 'success' : 'failed';
                acc[status] = (acc[status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            
            // Calculate total volume by denom
            const volumeByDenom = transfers.reduce((acc: Record<string, string>, transfer: IBCTransfer) => {
                const { denom, amount } = transfer;
                if (denom && amount) {
                    const currentAmount = acc[denom] ? BigInt(acc[denom]) : BigInt(0);
                    const transferAmount = BigInt(amount);
                    acc[denom] = (currentAmount + transferAmount).toString();
                }
                return acc;
            }, {} as Record<string, string>);
            
            // Count transfers by source chain
            const transfersBySourceChain = transfers.reduce((acc: Record<string, number>, transfer: IBCTransfer) => {
                const chainId = transfer.source_chain_id || 'unknown';
                acc[chainId] = (acc[chainId] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            
            // Count transfers by destination chain
            const transfersByDestChain = transfers.reduce((acc: Record<string, number>, transfer: IBCTransfer) => {
                const chainId = transfer.destination_chain_id || 'unknown';
                acc[chainId] = (acc[chainId] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            
            // Get top senders by volume
            interface SenderVolume {
                address: string;
                total_amount: string;
                transfer_count: number;
            }
            
            const senderVolumes = new Map<string, SenderVolume>();
            
            transfers.forEach((transfer: IBCTransfer) => {
                const { sender, amount } = transfer;
                if (sender && amount) {
                    if (!senderVolumes.has(sender)) {
                        senderVolumes.set(sender, {
                            address: sender,
                            total_amount: '0',
                            transfer_count: 0
                        });
                    }
                    
                    const senderData = senderVolumes.get(sender)!;
                    senderData.transfer_count += 1;
                    senderData.total_amount = (BigInt(senderData.total_amount) + BigInt(amount)).toString();
                }
            });
            
            const topSenders = Array.from(senderVolumes.values())
                .sort((a, b) => {
                    // Sort by transfer count first, then by total amount
                    if (b.transfer_count !== a.transfer_count) {
                        return b.transfer_count - a.transfer_count;
                    }
                    // For equal transfer counts, sort by amount
                    return Number(BigInt(b.total_amount) - BigInt(a.total_amount));
                })
                .slice(0, 10);
            
            // Calculate time-series data (transfers per day/hour)
            const timeSeriesData: number[] = [];
            
            if (period === '1h') {
                // For 1h, group by minutes (12 5-minute intervals)
                const minuteGroups = Array(12).fill(0);
                
                transfers.forEach((transfer: IBCTransfer) => {
                    if (transfer.send_time) {
                        const sendTime = new Date(transfer.send_time);
                        const minuteIndex = Math.floor(sendTime.getMinutes() / 5);
                        minuteGroups[minuteIndex]++;
                    }
                });
                
                timeSeriesData.push(...minuteGroups);
            } else if (period === '24h') {
                // For 24h, group by hour
                const hourGroups = Array(24).fill(0);
                
                transfers.forEach((transfer: IBCTransfer) => {
                    if (transfer.send_time) {
                        const sendTime = new Date(transfer.send_time);
                        hourGroups[sendTime.getHours()]++;
                    }
                });
                
                timeSeriesData.push(...hourGroups);
            } else if (period === '7d') {
                // For 7d, group by day
                const dayGroups = Array(7).fill(0);
                
                transfers.forEach((transfer: IBCTransfer) => {
                    if (transfer.send_time) {
                        const sendTime = new Date(transfer.send_time);
                        const daysSinceStart = Math.floor((sendTime.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                        if (daysSinceStart >= 0 && daysSinceStart < 7) {
                            dayGroups[daysSinceStart]++;
                        }
                    }
                });
                
                timeSeriesData.push(...dayGroups);
            } else if (period === '30d') {
                // For 30d, group by 3-day periods (10 groups)
                const monthGroups = Array(10).fill(0);
                
                transfers.forEach((transfer: IBCTransfer) => {
                    if (transfer.send_time) {
                        const sendTime = new Date(transfer.send_time);
                        const daysSinceStart = Math.floor((sendTime.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                        const groupIndex = Math.floor(daysSinceStart / 3);
                        if (groupIndex >= 0 && groupIndex < 10) {
                            monthGroups[groupIndex]++;
                        }
                    }
                });
                
                timeSeriesData.push(...monthGroups);
            }

            // Calculate completion time statistics where complete_time exists
            const transfersWithCompletionTime = transfers.filter((transfer: IBCTransfer) => 
                transfer.success && transfer.complete_time && transfer.send_time
            );
            
            let avgCompletionTimeMs = 0;
            let minCompletionTimeMs = 0;
            let maxCompletionTimeMs = 0;
            
            if (transfersWithCompletionTime.length > 0) {
                const completionTimes = transfersWithCompletionTime.map((transfer: IBCTransfer) => {
                    const completeTime = new Date(transfer.complete_time as Date).getTime();
                    const sendTime = new Date(transfer.send_time).getTime();
                    return completeTime - sendTime;
                });
                
                avgCompletionTimeMs = Math.round(completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length);
                minCompletionTimeMs = Math.min(...completionTimes);
                maxCompletionTimeMs = Math.max(...completionTimes);
            }
            
            // Calculate success rate including completion time stats
            const successRate = totalTransfers > 0 
                ? Math.round((transfersByStatus.success || 0) / totalTransfers * 100) 
                : 0;
                
            // Create final response with all statistics
            res.json({
                period,
                network: network.toString(),
                date_range: {
                    start: startDate.toISOString(),
                    end: now.toISOString()
                },
                total_transfers: totalTransfers,
                transfers_by_status: transfersByStatus,
                volume_by_denom: volumeByDenom,
                transfers_by_source_chain: transfersBySourceChain,
                transfers_by_destination_chain: transfersByDestChain,
                top_senders: topSenders,
                time_series_data: timeSeriesData,
                success_rate: successRate,
                completion_time_stats: {
                    transfers_with_completion_time: transfersWithCompletionTime.length,
                    avg_completion_time_ms: avgCompletionTimeMs,
                    min_completion_time_ms: minCompletionTimeMs,
                    max_completion_time_ms: maxCompletionTimeMs
                }
            });
        } catch (error) {
            logger.error('Error getting transfer stats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 