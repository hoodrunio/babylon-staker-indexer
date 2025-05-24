import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCConnectionRepository } from '../../../services/ibc/repository/IBCConnectionRepository';

export class IBCConnectionController {
    private static connectionRepository = new IBCConnectionRepository();

    /**
     * Get connection by ID
     */
    public static async getConnection(req: Request, res: Response) {
        try {
            const { connectionId } = req.params;
            const network = req.network || Network.MAINNET;

            const connection = await IBCConnectionController.connectionRepository.getConnection(connectionId, network);

            if (!connection) {
                return res.status(404).json({ error: 'Connection not found' });
            }

            res.json(connection);
        } catch (error) {
            logger.error('Error getting connection:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get all connections
     */
    public static async getAllConnections(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;
            const state = req.query.state as string;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const connections = await IBCConnectionController.connectionRepository.getAllConnections(network);
            
            // Filter by state if provided
            let filteredConnections = connections;
            if (state) {
                filteredConnections = connections.filter(connection => connection.state === state);
            }

            const paginatedConnections = filteredConnections.slice(offset, offset + limit);

            res.json({
                connections: paginatedConnections,
                total: filteredConnections.length,
                limit,
                offset,
                ...(state && { filter: { state } })
            });
        } catch (error) {
            logger.error('Error getting all connections:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get connections by counterparty chain
     */
    public static async getConnectionsByCounterparty(req: Request, res: Response) {
        try {
            const { chainId } = req.params;
            const network = req.network || Network.MAINNET;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;

            if (limit > 1000) {
                return res.status(400).json({ error: 'Limit cannot exceed 1000' });
            }

            const connections = await IBCConnectionController.connectionRepository.getConnectionsByCounterpartyChain(chainId, network);
            
            const paginatedConnections = connections.slice(offset, offset + limit);

            res.json({
                connections: paginatedConnections,
                total: connections.length,
                limit,
                offset,
                counterparty_chain_id: chainId
            });
        } catch (error) {
            logger.error('Error getting connections by counterparty:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Get connection statistics
     */
    public static async getConnectionStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            
            const allConnections = await IBCConnectionController.connectionRepository.getAllConnections(network);
            
            // Group connections by state
            const stateCounts = allConnections.reduce((acc, connection) => {
                const state = connection.state || 'UNKNOWN';
                acc[state] = (acc[state] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            // Get unique counterparty chains
            const counterpartyChains = new Set(
                allConnections
                    .map(connection => connection.counterparty_chain_id)
                    .filter(chainId => chainId && chainId !== 'unknown')
            );

            res.json({
                total_connections: allConnections.length,
                by_state: stateCounts,
                connected_chains: counterpartyChains.size,
                counterparty_chains: Array.from(counterpartyChains),
                network: network.toString()
            });
        } catch (error) {
            logger.error('Error getting connection stats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 