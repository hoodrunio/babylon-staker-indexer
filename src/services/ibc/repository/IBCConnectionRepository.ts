import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import IBCConnection from '../../../database/models/ibc/IBCConnection';
import { IBCClientRepository } from './IBCClientRepository';

/**
 * Repository for managing IBC connection data
 */
export class IBCConnectionRepository {
    private clientRepository: IBCClientRepository;

    constructor() {
        this.clientRepository = new IBCClientRepository();
    }

    /**
     * Save or update a connection in the database
     */
    public async saveConnection(connectionData: any, network: Network): Promise<any> {
        try {
            logger.debug(`[IBCConnectionRepository] Save connection data for network ${network}: ${JSON.stringify(connectionData)}`);
            
            const conn = await IBCConnection.findOneAndUpdate(
                { connection_id: connectionData.connection_id, network: network.toString() },
                {
                    ...connectionData,
                    network: network.toString(),
                    updated_at: new Date()
                },
                { upsert: true, new: true }
            );

            // Update connection count on client if this is a new connection
            if (conn && connectionData.client_id) {
                await this.clientRepository.incrementConnectionCount(connectionData.client_id, network);
            }

            return conn;
        } catch (error) {
            logger.error(`[IBCConnectionRepository] Error saving connection: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get a connection by ID
     */
    public async getConnection(connectionId: string, network: Network): Promise<any> {
        try {
            logger.debug(`[IBCConnectionRepository] Get connection ${connectionId} for network ${network}`);
            return await IBCConnection.findOne({ connection_id: connectionId, network: network.toString() });
        } catch (error) {
            logger.error(`[IBCConnectionRepository] Error getting connection: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Get all connections for a specific client
     */
    public async getConnectionsByClient(clientId: string, network: Network): Promise<any[]> {
        try {
            return await IBCConnection.find({ client_id: clientId, network: network.toString() });
        } catch (error) {
            logger.error(`[IBCConnectionRepository] Error getting connections by client: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Get all connections for a specific counterparty chain
     */
    public async getConnectionsByCounterpartyChain(chainId: string, network: Network): Promise<any[]> {
        try {
            return await IBCConnection.find({ counterparty_chain_id: chainId, network: network.toString() });
        } catch (error) {
            logger.error(`[IBCConnectionRepository] Error getting connections by counterparty chain: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Update the channel count for a connection
     */
    public async incrementChannelCount(connectionId: string, network: Network): Promise<void> {
        try {
            await IBCConnection.updateOne(
                { connection_id: connectionId, network: network.toString() },
                { $inc: { channel_count: 1 }, $set: { last_activity: new Date() } }
            );
        } catch (error) {
            logger.error(`[IBCConnectionRepository] Error updating channel count: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get all connections for a specific network
     */
    public async getAllConnections(network: Network): Promise<any[]> {
        try {
            return await IBCConnection.find({ network: network.toString() });
        } catch (error) {
            logger.error(`[IBCConnectionRepository] Error getting all connections: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
}
