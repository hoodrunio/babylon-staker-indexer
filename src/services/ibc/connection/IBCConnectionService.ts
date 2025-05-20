import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCConnectionRepository } from '../repository/IBCConnectionRepository';

/**
 * Service responsible for processing and managing IBC connection data
 * Following Single Responsibility Principle - focuses only on connection operations
 */
export class IBCConnectionService {
    private connectionRepository: IBCConnectionRepository;

    constructor() {
        this.connectionRepository = new IBCConnectionRepository();
    }

    /**
     * Process a connection-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processConnectionEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCConnectionService] Processing connection event: ${event.type} in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.extractEventAttributes(event);
            
            switch (event.type) {
                case 'connection_open_init':
                    await this.handleConnectionOpenInit(attributes, txHash, height, timestamp, network);
                    break;
                case 'connection_open_try':
                    await this.handleConnectionOpenTry(attributes, txHash, height, timestamp, network);
                    break;
                case 'connection_open_ack':
                    await this.handleConnectionOpenAck(attributes, txHash, height, timestamp, network);
                    break;
                case 'connection_open_confirm':
                    await this.handleConnectionOpenConfirm(attributes, txHash, height, timestamp, network);
                    break;
                default:
                    logger.debug(`[IBCConnectionService] Unhandled connection event type: ${event.type}`);
            }
        } catch (error) {
            logger.error(`[IBCConnectionService] Error processing connection event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle connection open init events
     */
    private async handleConnectionOpenInit(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const connectionId = attributes.connection_id;
            const clientId = attributes.client_id;
            const counterpartyClientId = attributes.counterparty_client_id;
            
            if (!connectionId || !clientId || !counterpartyClientId) {
                logger.warn(`[IBCConnectionService] Missing required attributes for connection_open_init`);
                return;
            }
            
            const connectionData = {
                connection_id: connectionId,
                client_id: clientId,
                counterparty_client_id: counterpartyClientId,
                counterparty_connection_id: '', // Will be populated in later events
                state: 'INIT',
                tx_hash: txHash,
                height,
                timestamp,
                network: network.toString()
            };
            
            await this.connectionRepository.saveConnection(connectionData, network);
            logger.info(`[IBCConnectionService] Connection initialized: ${connectionId} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCConnectionService] Error handling connection_open_init: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle connection open try events
     */
    private async handleConnectionOpenTry(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const connectionId = attributes.connection_id;
            const clientId = attributes.client_id;
            const counterpartyConnectionId = attributes.counterparty_connection_id;
            const counterpartyClientId = attributes.counterparty_client_id;
            
            if (!connectionId || !clientId || !counterpartyConnectionId || !counterpartyClientId) {
                logger.warn(`[IBCConnectionService] Missing required attributes for connection_open_try`);
                return;
            }
            
            const connectionData = {
                connection_id: connectionId,
                client_id: clientId,
                counterparty_client_id: counterpartyClientId,
                counterparty_connection_id: counterpartyConnectionId,
                state: 'TRYOPEN',
                tx_hash: txHash,
                height,
                timestamp,
                network: network.toString()
            };
            
            await this.connectionRepository.saveConnection(connectionData, network);
            logger.info(`[IBCConnectionService] Connection try open: ${connectionId} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCConnectionService] Error handling connection_open_try: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle connection open ack events
     */
    private async handleConnectionOpenAck(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const connectionId = attributes.connection_id;
            const counterpartyConnectionId = attributes.counterparty_connection_id;
            
            if (!connectionId || !counterpartyConnectionId) {
                logger.warn(`[IBCConnectionService] Missing required attributes for connection_open_ack`);
                return;
            }
            
            // Get existing connection data
            const existingConnection = await this.connectionRepository.getConnection(connectionId, network);
            
            const connectionData = {
                ...(existingConnection || {}),
                connection_id: connectionId,
                counterparty_connection_id: counterpartyConnectionId,
                state: 'OPEN',
                tx_hash: txHash,
                height,
                timestamp,
                network: network.toString()
            };
            
            await this.connectionRepository.saveConnection(connectionData, network);
            logger.info(`[IBCConnectionService] Connection acknowledged: ${connectionId} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCConnectionService] Error handling connection_open_ack: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle connection open confirm events
     */
    private async handleConnectionOpenConfirm(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const connectionId = attributes.connection_id;
            
            if (!connectionId) {
                logger.warn(`[IBCConnectionService] Missing required attributes for connection_open_confirm`);
                return;
            }
            
            // Get existing connection data
            const existingConnection = await this.connectionRepository.getConnection(connectionId, network);
            
            const connectionData = {
                ...(existingConnection || {}),
                connection_id: connectionId,
                state: 'OPEN',
                tx_hash: txHash,
                height,
                timestamp,
                network: network.toString()
            };
            
            await this.connectionRepository.saveConnection(connectionData, network);
            logger.info(`[IBCConnectionService] Connection confirmed: ${connectionId} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCConnectionService] Error handling connection_open_confirm: ${error instanceof Error ? error.message : String(error)}`);
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
