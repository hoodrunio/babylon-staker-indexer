import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import IBCClient from '../../../database/models/ibc/IBCClient';

/**
 * Repository for managing IBC client data
 */
export class IBCClientRepository {
    /**
     * Save or update a client in the database
     */
    public async saveClient(clientData: any, network: Network): Promise<any> {
        try {
            logger.debug(`[IBCClientRepository] Save client data for network ${network}: ${JSON.stringify(clientData)}`);
            
            return await IBCClient.findOneAndUpdate(
                { client_id: clientData.client_id, network: network.toString() },
                {
                    ...clientData,
                    network: network.toString(),
                    updated_at: new Date()
                },
                { upsert: true, new: true }
            );
        } catch (error) {
            logger.error(`[IBCClientRepository] Error saving client: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get a client by ID
     */
    public async getClient(clientId: string, network: Network): Promise<any> {
        try {
            logger.debug(`[IBCClientRepository] Get client ${clientId} for network ${network}`);
            return await IBCClient.findOne({ client_id: clientId, network: network.toString() });
        } catch (error) {
            logger.error(`[IBCClientRepository] Error getting client: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Update the connection count for a client
     */
    public async incrementConnectionCount(clientId: string, network: Network): Promise<void> {
        try {
            await IBCClient.updateOne(
                { client_id: clientId, network: network.toString() },
                { $inc: { connection_count: 1 }, $set: { last_update: new Date() } }
            );
        } catch (error) {
            logger.error(`[IBCClientRepository] Error updating connection count: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get all clients for a specific network
     */
    public async getAllClients(network: Network): Promise<any[]> {
        try {
            return await IBCClient.find({ network: network.toString() });
        } catch (error) {
            logger.error(`[IBCClientRepository] Error getting all clients: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Get clients by chain ID
     */
    public async getClientsByChainId(chainId: string, network: Network): Promise<any[]> {
        try {
            return await IBCClient.find({ chain_id: chainId, network: network.toString() });
        } catch (error) {
            logger.error(`[IBCClientRepository] Error getting clients by chain: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
}
