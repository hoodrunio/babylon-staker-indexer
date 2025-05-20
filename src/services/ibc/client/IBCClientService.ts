import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCClientRepository } from '../repository/IBCClientRepository';

/**
 * Service responsible for processing and managing IBC client data
 * Following Single Responsibility Principle - focuses only on client operations
 */
export class IBCClientService {
    private clientRepository: IBCClientRepository;

    constructor() {
        this.clientRepository = new IBCClientRepository();
    }

    /**
     * Process a client-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processClientEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCClientService] Processing client event: ${event.type} in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.extractEventAttributes(event);
            
            switch (event.type) {
                case 'create_client':
                    await this.handleCreateClient(attributes, txHash, height, timestamp, network);
                    break;
                case 'update_client':
                    await this.handleUpdateClient(attributes, txHash, height, timestamp, network);
                    break;
                case 'client_misbehaviour':
                    await this.handleClientMisbehaviour(attributes, txHash, height, timestamp, network);
                    break;
                case 'upgrade_client':
                    await this.handleUpgradeClient(attributes, txHash, height, timestamp, network);
                    break;
                default:
                    logger.debug(`[IBCClientService] Unhandled client event type: ${event.type}`);
            }
        } catch (error) {
            logger.error(`[IBCClientService] Error processing client event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle create client events
     */
    private async handleCreateClient(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const clientId = attributes.client_id;
            const clientType = attributes.client_type;
            
            if (!clientId || !clientType) {
                logger.warn(`[IBCClientService] Missing required attributes for create_client`);
                return;
            }
            
            const clientData = {
                client_id: clientId,
                client_type: clientType,
                state: 'ACTIVE',
                latest_height: height,
                tx_hash: txHash,
                created_at: timestamp,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.clientRepository.saveClient(clientData, network);
            logger.info(`[IBCClientService] Client created: ${clientId} of type ${clientType} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCClientService] Error handling create_client: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle update client events
     */
    private async handleUpdateClient(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const clientId = attributes.client_id;
            const clientType = attributes.client_type;
            const consensusHeight = attributes.consensus_height;
            
            if (!clientId) {
                logger.warn(`[IBCClientService] Missing required attributes for update_client`);
                return;
            }
            
            // Get existing client data
            const existingClient = await this.clientRepository.getClient(clientId, network);
            
            const clientData = {
                ...(existingClient || {}),
                client_id: clientId,
                client_type: clientType || existingClient?.client_type,
                latest_height: height,
                consensus_height: consensusHeight,
                tx_hash: txHash,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.clientRepository.saveClient(clientData, network);
            logger.info(`[IBCClientService] Client updated: ${clientId} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCClientService] Error handling update_client: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle client misbehaviour events
     */
    private async handleClientMisbehaviour(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const clientId = attributes.client_id;
            
            if (!clientId) {
                logger.warn(`[IBCClientService] Missing required attributes for client_misbehaviour`);
                return;
            }
            
            // Get existing client data
            const existingClient = await this.clientRepository.getClient(clientId, network);
            
            const clientData = {
                ...(existingClient || {}),
                client_id: clientId,
                state: 'FROZEN',
                latest_height: height,
                tx_hash: txHash,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.clientRepository.saveClient(clientData, network);
            logger.info(`[IBCClientService] Client misbehaviour detected: ${clientId} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCClientService] Error handling client_misbehaviour: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle upgrade client events
     */
    private async handleUpgradeClient(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const clientId = attributes.client_id;
            
            if (!clientId) {
                logger.warn(`[IBCClientService] Missing required attributes for upgrade_client`);
                return;
            }
            
            // Get existing client data
            const existingClient = await this.clientRepository.getClient(clientId, network);
            
            const clientData = {
                ...(existingClient || {}),
                client_id: clientId,
                latest_height: height,
                tx_hash: txHash,
                upgraded_at: timestamp,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.clientRepository.saveClient(clientData, network);
            logger.info(`[IBCClientService] Client upgraded: ${clientId} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCClientService] Error handling upgrade_client: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Extract attributes from an event into a key-value map
     */
    private extractEventAttributes(event: any): Record<string, string> {
        const attributes: Record<string, string> = {};
        
        if (!event.attributes || !Array.isArray(event.attributes)) {
            return attributes;
        }
        
        for (const attr of event.attributes) {
            if (attr.key && attr.value) {
                attributes[attr.key] = attr.value;
            }
        }
        
        return attributes;
    }
}
