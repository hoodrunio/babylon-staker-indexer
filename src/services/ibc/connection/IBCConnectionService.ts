import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCConnectionRepository } from '../repository/IBCConnectionRepository';
import { IBCEventUtils } from '../common/IBCEventUtils';

/**
 * Service responsible for processing and managing IBC connection data
 * Following Single Responsibility Principle - focuses only on connection operations
 */
export class IBCConnectionService {
    private readonly serviceName = 'IBCConnectionService';
    private connectionRepository: IBCConnectionRepository;

    constructor(connectionRepository?: IBCConnectionRepository) {
        this.connectionRepository = connectionRepository || new IBCConnectionRepository();
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
            IBCEventUtils.logEventStart(this.serviceName, event.type, txHash);
            
            // Extract attributes from event
            const attributes = IBCEventUtils.extractEventAttributes(event);
            
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
                    // Do not log unhandled events as warnings - they may be processed by other services
                    break;
            }
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, event.type, error);
        }
    }

    /**
     * Handle connection_open_init events
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
                logger.warn(`[${this.serviceName}] Missing required attributes for connection_open_init`);
                return;
            }
            
            const connectionData = {
                connection_id: connectionId,
                client_id: clientId,
                counterparty_connection_id: '',  // Will be set in try/ack
                counterparty_client_id: counterpartyClientId,
                state: 'INIT',
                tx_hash: txHash,
                created_at: timestamp,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.connectionRepository.saveConnection(connectionData, network);
            IBCEventUtils.logEventSuccess(this.serviceName, 'connection_open_init', `Connection initialized: ${connectionId}`, height);
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, 'connection_open_init', error);
        }
    }

    /**
     * Handle connection_open_try events
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
                logger.warn(`[${this.serviceName}] Missing required attributes for connection_open_try`);
                return;
            }
            
            const connectionData = {
                connection_id: connectionId,
                client_id: clientId,
                counterparty_connection_id: counterpartyConnectionId,
                counterparty_client_id: counterpartyClientId,
                state: 'TRYOPEN',
                tx_hash: txHash,
                created_at: timestamp,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.connectionRepository.saveConnection(connectionData, network);
            IBCEventUtils.logEventSuccess(this.serviceName, 'connection_open_try', `Connection try open: ${connectionId}`, height);
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, 'connection_open_try', error);
        }
    }

    /**
     * Handle connection_open_ack events
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
                logger.warn(`[${this.serviceName}] Missing required attributes for connection_open_ack`);
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
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.connectionRepository.saveConnection(connectionData, network);
            IBCEventUtils.logEventSuccess(this.serviceName, 'connection_open_ack', `Connection acknowledged: ${connectionId}`, height);
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, 'connection_open_ack', error);
        }
    }

    /**
     * Handle connection_open_confirm events
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
                logger.warn(`[${this.serviceName}] Missing required attributes for connection_open_confirm`);
                return;
            }
            
            // Get existing connection data
            const existingConnection = await this.connectionRepository.getConnection(connectionId, network);
            
            const connectionData = {
                ...(existingConnection || {}),
                connection_id: connectionId,
                state: 'OPEN',
                tx_hash: txHash,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.connectionRepository.saveConnection(connectionData, network);
            IBCEventUtils.logEventSuccess(this.serviceName, 'connection_open_confirm', `Connection confirmed: ${connectionId}`, height);
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, 'connection_open_confirm', error);
        }
    }

    /**
     * Get a connection by ID
     */
    public async getConnection(connectionId: string, network: Network): Promise<any> {
        return this.connectionRepository.getConnection(connectionId, network);
    }

    /**
     * Get all connections for a specific counterparty chain
     */
    public async getConnectionsByCounterparty(counterpartyChainId: string, network: Network): Promise<any[]> {
        return this.connectionRepository.getConnectionsByCounterpartyChain(counterpartyChainId, network);
    }
}
