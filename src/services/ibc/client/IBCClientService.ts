import { Network } from '../../../types/finality';
import { IBCClientRepository } from '../repository/IBCClientRepository';
import { IBCEventUtils } from '../common/IBCEventUtils';

/**
 * Service responsible for processing and managing IBC client data
 * Following Single Responsibility Principle - focuses only on client operations
 */
export class IBCClientService {
    private readonly serviceName = 'IBCClientService';
    private clientRepository: IBCClientRepository;

    constructor(clientRepository?: IBCClientRepository) {
        this.clientRepository = clientRepository || new IBCClientRepository();
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
            IBCEventUtils.logEventStart(this.serviceName, event.type, txHash);
            
            // Extract attributes from event
            const attributes = IBCEventUtils.extractEventAttributes(event);
            
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
                    // Do not log unhandled events as warnings - they may be processed by other services
                    break;
            }
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, event.type, error);
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
            const requiredKeys = ['client_id', 'client_type'];
            if (!IBCEventUtils.validateRequiredAttributes(attributes, requiredKeys, 'create_client')) {
                return;
            }
            
            const clientData = {
                client_id: attributes.client_id,
                client_type: attributes.client_type,
                state: 'ACTIVE',
                latest_height: height,
                tx_hash: txHash,
                created_at: timestamp,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.clientRepository.saveClient(clientData, network);
            IBCEventUtils.logEventSuccess(
                this.serviceName, 
                'create_client',
                `Client created: ${attributes.client_id} of type ${attributes.client_type}`,
                height
            );
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, 'create_client', error);
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
            const requiredKeys = ['client_id'];
            if (!IBCEventUtils.validateRequiredAttributes(attributes, requiredKeys, 'update_client')) {
                return;
            }
            
            // Get existing client data
            const existingClient = await this.clientRepository.getClient(attributes.client_id, network);
            
            const clientData = {
                ...(existingClient || {}),
                client_id: attributes.client_id,
                client_type: attributes.client_type || existingClient?.client_type,
                latest_height: height,
                consensus_height: attributes.consensus_height,
                tx_hash: txHash,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.clientRepository.saveClient(clientData, network);
            IBCEventUtils.logEventSuccess(
                this.serviceName,
                'update_client', 
                `Client updated: ${attributes.client_id}`,
                height
            );
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, 'update_client', error);
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
            const requiredKeys = ['client_id'];
            if (!IBCEventUtils.validateRequiredAttributes(attributes, requiredKeys, 'client_misbehaviour')) {
                return;
            }
            
            // Get existing client data
            const existingClient = await this.clientRepository.getClient(attributes.client_id, network);
            
            const clientData = {
                ...(existingClient || {}),
                client_id: attributes.client_id,
                state: 'FROZEN',
                latest_height: height,
                tx_hash: txHash,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.clientRepository.saveClient(clientData, network);
            IBCEventUtils.logEventSuccess(
                this.serviceName,
                'client_misbehaviour',
                `Client misbehaviour detected: ${attributes.client_id}`,
                height
            );
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, 'client_misbehaviour', error);
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
            const requiredKeys = ['client_id'];
            if (!IBCEventUtils.validateRequiredAttributes(attributes, requiredKeys, 'upgrade_client')) {
                return;
            }
            
            // Get existing client data
            const existingClient = await this.clientRepository.getClient(attributes.client_id, network);
            
            const clientData = {
                ...(existingClient || {}),
                client_id: attributes.client_id,
                latest_height: height,
                tx_hash: txHash,
                upgraded_at: timestamp,
                updated_at: timestamp,
                network: network.toString()
            };
            
            await this.clientRepository.saveClient(clientData, network);
            IBCEventUtils.logEventSuccess(
                this.serviceName,
                'upgrade_client',
                `Client upgraded: ${attributes.client_id}`,
                height
            );
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, 'upgrade_client', error);
        }
    }

    /**
     * Get a client by ID
     */
    public async getClient(clientId: string, network: Network): Promise<any> {
        return this.clientRepository.getClient(clientId, network);
    }

    /**
     * Get all clients for a specific counterparty chain
     */
    public async getClientsByChainId(chainId: string, network: Network): Promise<any[]> {
        return this.clientRepository.getClientsByChainId(chainId, network);
    }
}

