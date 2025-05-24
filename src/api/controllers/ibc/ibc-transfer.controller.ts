import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCTransferRepository } from '../../../services/ibc/repository/IBCTransferRepository';
import mongoose from 'mongoose';

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

            // This would need to be implemented in the repository
            // For now, return a basic response
            res.json({
                period,
                network: network.toString(),
                message: 'Transfer statistics endpoint - implementation pending'
            });
        } catch (error) {
            logger.error('Error getting transfer stats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 