import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCClientRepository } from '../../../services/ibc/repository/IBCClientRepository';

export class IBCClientController {
    private static clientRepository = new IBCClientRepository();

    /**
     * Get client by ID
     */
    public static async getClient(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            const network = req.network || Network.MAINNET;

            const client = await IBCClientController.clientRepository.getClient(clientId, network);

            if (!client) {
                return res.status(404).json({ error: 'Client not found' });
            }

            res.json(client);
        } catch (error) {
            logger.error('Error getting client:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get all clients
     */
    public static async getAllClients(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;
            const state = req.query.state as string;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const clients = await IBCClientController.clientRepository.getAllClients(network);
            
            // Filter by state if provided
            let filteredClients = clients;
            if (state) {
                filteredClients = clients.filter(client => client.state === state);
            }

            const paginatedClients = filteredClients.slice(offset, offset + limit);

            res.json({
                clients: paginatedClients,
                total: filteredClients.length,
                limit,
                offset,
                ...(state && { filter: { state } })
            });
        } catch (error) {
            logger.error('Error getting all clients:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get clients by chain ID
     */
    public static async getClientsByChain(req: Request, res: Response) {
        try {
            const { chainId } = req.params;
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const clients = await IBCClientController.clientRepository.getClientsByChainId(chainId, network);
            
            const paginatedClients = clients.slice(offset, offset + limit);

            res.json({
                clients: paginatedClients,
                total: clients.length,
                limit,
                offset,
                chain_id: chainId
            });
        } catch (error) {
            logger.error('Error getting clients by chain:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get client statistics
     */
    public static async getClientStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            
            const allClients = await IBCClientController.clientRepository.getAllClients(network);
            
            // Group clients by state
            const stateCounts = allClients.reduce((acc, client) => {
                const state = client.state || 'UNKNOWN';
                acc[state] = (acc[state] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            // Group clients by chain ID
            const chainCounts = allClients.reduce((acc, client) => {
                const chainId = client.chain_id || 'unknown';
                acc[chainId] = (acc[chainId] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            res.json({
                total_clients: allClients.length,
                by_state: stateCounts,
                by_chain: chainCounts,
                network: network.toString()
            });
        } catch (error) {
            logger.error('Error getting client stats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 