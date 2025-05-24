import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCRelayerRepository } from '../../../services/ibc/repository/IBCRelayerRepository';

export class IBCRelayerController {
    private static relayerRepository = new IBCRelayerRepository();

    /**
     * Get relayer statistics by address
     */
    public static async getRelayerStats(req: Request, res: Response) {
        try {
            const { address } = req.params;
            const network = req.network || Network.MAINNET;

            const relayerStats = await IBCRelayerController.relayerRepository.getRelayer(address, network);

            if (!relayerStats) {
                return res.status(404).json({ error: 'Relayer not found' });
            }

            res.json(relayerStats);
        } catch (error) {
            logger.error('Error getting relayer stats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get top relayers by activity
     */
    public static async getTopRelayers(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 10;

            if (limit > 100) {
                return res.status(400).json({ error: 'Limit cannot exceed 100' });
            }

            const topRelayers = await IBCRelayerController.relayerRepository.getTopRelayers(limit, network);

            res.json({
                relayers: topRelayers,
                limit,
                network: network.toString()
            });
        } catch (error) {
            logger.error('Error getting top relayers:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get relayers by chain
     */
    public static async getRelayersByChain(req: Request, res: Response) {
        try {
            const { chainId } = req.params;
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const relayers = await IBCRelayerController.relayerRepository.getRelayersByChain(chainId, network);
            
            const paginatedRelayers = relayers.slice(offset, offset + limit);

            res.json({
                relayers: paginatedRelayers,
                total: relayers.length,
                limit,
                offset,
                chain_id: chainId
            });
        } catch (error) {
            logger.error('Error getting relayers by chain:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 