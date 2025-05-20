import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCClientRepository } from '../repository/IBCClientRepository';
import { IBCConnectionRepository } from '../repository/IBCConnectionRepository';
import { IBCChannelRepository } from '../repository/IBCChannelRepository';
import { BabylonClient } from '../../../clients/BabylonClient';
import axios from 'axios';

/**
 * Service responsible for reconciling IBC state data with authoritative sources
 * Implements the hybrid approach by periodically checking state against IBC query endpoints
 */
export class IBCReconciliationService {
    private clientRepository: IBCClientRepository;
    private connectionRepository: IBCConnectionRepository;
    private channelRepository: IBCChannelRepository;
    private babylonClient: BabylonClient;
    private reconciliationInterval: NodeJS.Timeout | null = null;
    private intervalMs: number = 5 * 60 * 1000; // 5 minutes by default

    constructor() {
        this.clientRepository = new IBCClientRepository();
        this.connectionRepository = new IBCConnectionRepository();
        this.channelRepository = new IBCChannelRepository();
        this.babylonClient = BabylonClient.getInstance();
    }

    /**
     * Start the reconciliation process
     * @param intervalMs Optional override for reconciliation interval (in milliseconds)
     */
    public start(intervalMs?: number): void {
        if (intervalMs && intervalMs > 0) {
            this.intervalMs = intervalMs;
        }
        
        // Stop any existing interval
        this.stop();
        
        logger.info(`[IBCReconciliationService] Starting reconciliation service with interval of ${this.intervalMs}ms`);
        
        // Set up new interval
        this.reconciliationInterval = setInterval(async () => {
            try {
                for (const network of Object.values(Network)) {
                    await this.performReconciliation(network);
                }
            } catch (error) {
                logger.error(`[IBCReconciliationService] Error during reconciliation: ${error instanceof Error ? error.message : String(error)}`);
            }
        }, this.intervalMs);
    }

    /**
     * Stop the reconciliation process
     */
    public stop(): void {
        if (this.reconciliationInterval) {
            clearInterval(this.reconciliationInterval);
            this.reconciliationInterval = null;
            logger.info('[IBCReconciliationService] Reconciliation service stopped');
        }
    }

    /**
     * Perform reconciliation for a specific network
     * @param network Network to reconcile
     */
    public async performReconciliation(network: Network): Promise<void> {
        logger.info(`[IBCReconciliationService] Starting reconciliation for network: ${network}`);
        
        try {
            // Reconcile clients
            await this.reconcileClients(network);
            
            // Reconcile connections
            await this.reconcileConnections(network);
            
            // Reconcile channels
            await this.reconcileChannels(network);
            
            logger.info(`[IBCReconciliationService] Reconciliation completed successfully for network: ${network}`);
        } catch (error) {
            logger.error(`[IBCReconciliationService] Error reconciling network ${network}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Reconcile IBC clients with authoritative source
     * @param network Network to reconcile
     */
    private async reconcileClients(network: Network): Promise<void> {
        logger.debug(`[IBCReconciliationService] Reconciling clients for network: ${network}`);
        
        try {
            // Get clients from our database
            const dbClients = await this.clientRepository.getAllClients(network);
            
            // Get clients from IBC query endpoint
            const apiClients = await this.fetchClientsFromAPI(network);
            
            // Compare and update as needed
            for (const apiClient of apiClients) {
                const dbClient = dbClients.find(c => c.client_id === apiClient.client_id);
                
                if (!dbClient) {
                    // Client exists in API but not in our database
                    logger.info(`[IBCReconciliationService] Found new client ${apiClient.client_id} not in database, adding it`);
                    await this.clientRepository.saveClient(apiClient, network);
                } else if (this.isClientDataDifferent(dbClient, apiClient)) {
                    // Client exists but data is different
                    logger.info(`[IBCReconciliationService] Client ${apiClient.client_id} has different data, updating`);
                    await this.clientRepository.saveClient(apiClient, network);
                }
            }
            
            // Check for clients in our database that no longer exist or are inactive
            for (const dbClient of dbClients) {
                const apiClient = apiClients.find(c => c.client_id === dbClient.client_id);
                
                if (!apiClient) {
                    // Client exists in our database but not in API response
                    logger.info(`[IBCReconciliationService] Client ${dbClient.client_id} not found in API response, marking as inactive`);
                    await this.clientRepository.saveClient({
                        ...dbClient,
                        status: 'INACTIVE',
                        updated_at: new Date()
                    }, network);
                }
            }
            
            logger.debug(`[IBCReconciliationService] Successfully reconciled ${apiClients.length} clients for network: ${network}`);
        } catch (error) {
            logger.error(`[IBCReconciliationService] Error reconciling clients: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Reconcile IBC connections with authoritative source
     * @param network Network to reconcile
     */
    private async reconcileConnections(network: Network): Promise<void> {
        logger.debug(`[IBCReconciliationService] Reconciling connections for network: ${network}`);
        
        try {
            // Get connections from our database
            const dbConnections = await this.connectionRepository.getAllConnections(network);
            
            // Get connections from IBC query endpoint
            const apiConnections = await this.fetchConnectionsFromAPI(network);
            
            // Compare and update as needed
            for (const apiConn of apiConnections) {
                const dbConn = dbConnections.find(c => c.connection_id === apiConn.connection_id);
                
                if (!dbConn) {
                    // Connection exists in API but not in our database
                    logger.info(`[IBCReconciliationService] Found new connection ${apiConn.connection_id} not in database, adding it`);
                    await this.connectionRepository.saveConnection(apiConn, network);
                } else if (this.isConnectionDataDifferent(dbConn, apiConn)) {
                    // Connection exists but data is different
                    logger.info(`[IBCReconciliationService] Connection ${apiConn.connection_id} has different data, updating`);
                    await this.connectionRepository.saveConnection(apiConn, network);
                }
            }
            
            // Check for connections in our database that no longer exist or are inactive
            for (const dbConn of dbConnections) {
                const apiConn = apiConnections.find(c => c.connection_id === dbConn.connection_id);
                
                if (!apiConn) {
                    // Connection exists in our database but not in API response
                    logger.info(`[IBCReconciliationService] Connection ${dbConn.connection_id} not found in API response, marking as inactive`);
                    await this.connectionRepository.saveConnection({
                        ...dbConn,
                        state: 'INACTIVE',
                        updated_at: new Date()
                    }, network);
                }
            }
            
            logger.debug(`[IBCReconciliationService] Successfully reconciled ${apiConnections.length} connections for network: ${network}`);
        } catch (error) {
            logger.error(`[IBCReconciliationService] Error reconciling connections: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Reconcile IBC channels with authoritative source
     * @param network Network to reconcile
     */
    private async reconcileChannels(network: Network): Promise<void> {
        logger.debug(`[IBCReconciliationService] Reconciling channels for network: ${network}`);
        
        try {
            // Get channels from our database
            const dbChannels = await this.channelRepository.getAllChannels(network);
            
            // Get channels from IBC query endpoint
            const apiChannels = await this.fetchChannelsFromAPI(network);
            
            // Compare and update as needed
            for (const apiChannel of apiChannels) {
                const dbChannel = dbChannels.find(c => 
                    c.port_id === apiChannel.port_id && 
                    c.channel_id === apiChannel.channel_id
                );
                
                if (!dbChannel) {
                    // Channel exists in API but not in our database
                    logger.info(`[IBCReconciliationService] Found new channel ${apiChannel.channel_id} on port ${apiChannel.port_id} not in database, adding it`);
                    await this.channelRepository.saveChannel(apiChannel, network);
                } else if (this.isChannelDataDifferent(dbChannel, apiChannel)) {
                    // Channel exists but data is different
                    logger.info(`[IBCReconciliationService] Channel ${apiChannel.channel_id} on port ${apiChannel.port_id} has different data, updating`);
                    await this.channelRepository.saveChannel(apiChannel, network);
                }
            }
            
            // Check for channels in our database that no longer exist or are inactive
            for (const dbChannel of dbChannels) {
                const apiChannel = apiChannels.find(c => 
                    c.port_id === dbChannel.port_id && 
                    c.channel_id === dbChannel.channel_id
                );
                
                if (!apiChannel) {
                    // Channel exists in our database but not in API response
                    logger.info(`[IBCReconciliationService] Channel ${dbChannel.channel_id} on port ${dbChannel.port_id} not found in API response, marking as inactive`);
                    await this.channelRepository.saveChannel({
                        ...dbChannel,
                        state: 'INACTIVE',
                        updated_at: new Date()
                    }, network);
                }
            }
            
            logger.debug(`[IBCReconciliationService] Successfully reconciled ${apiChannels.length} channels for network: ${network}`);
        } catch (error) {
            logger.error(`[IBCReconciliationService] Error reconciling channels: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Fetch clients from IBC query API
     * @param network Network to query
     * @returns Array of client data
     */
    private async fetchClientsFromAPI(network: Network): Promise<any[]> {
        try {
            // Use BabylonClient to get the LCD URL for the specific network
            const lcdEndpoint = this.getLCDEndpoint(network);
            const response = await axios.get(`${lcdEndpoint}/ibc/core/client/v1/clients`);
            
            if (response.data && response.data.clients) {
                return response.data.clients.map((client: any) => ({
                    client_id: client.client_id,
                    client_type: client.client_type,
                    client_state: client.client_state,
                    latest_height: client.latest_height,
                    status: 'ACTIVE',
                    updated_at: new Date()
                }));
            }
            
            return [];
        } catch (error) {
            logger.error(`[IBCReconciliationService] Error fetching clients from API: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Fetch connections from IBC query API
     * @param network Network to query
     * @returns Array of connection data
     */
    private async fetchConnectionsFromAPI(network: Network): Promise<any[]> {
        try {
            // Use BabylonClient to get the LCD URL for the specific network
            const lcdEndpoint = this.getLCDEndpoint(network);
            const response = await axios.get(`${lcdEndpoint}/ibc/core/connection/v1/connections`);
            
            if (response.data && response.data.connections) {
                return response.data.connections.map((conn: any) => ({
                    connection_id: conn.id,
                    client_id: conn.client_id,
                    counterparty_connection_id: conn.counterparty?.connection_id || '',
                    counterparty_client_id: conn.counterparty?.client_id || '',
                    state: conn.state,
                    updated_at: new Date()
                }));
            }
            
            return [];
        } catch (error) {
            logger.error(`[IBCReconciliationService] Error fetching connections from API: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Fetch channels from IBC query API
     * @param network Network to query
     * @returns Array of channel data
     */
    private async fetchChannelsFromAPI(network: Network): Promise<any[]> {
        try {
            // Use BabylonClient to get the LCD URL for the specific network
            const lcdEndpoint = this.getLCDEndpoint(network);
            const response = await axios.get(`${lcdEndpoint}/ibc/core/channel/v1/channels`);
            
            if (response.data && response.data.channels) {
                return response.data.channels.map((channel: any) => ({
                    channel_id: channel.channel_id,
                    port_id: channel.port_id,
                    connection_id: channel.connection_hops?.[0] || '',
                    counterparty_channel_id: channel.counterparty?.channel_id || '',
                    counterparty_port_id: channel.counterparty?.port_id || '',
                    state: channel.state,
                    ordering: channel.ordering,
                    updated_at: new Date()
                }));
            }
            
            return [];
        } catch (error) {
            logger.error(`[IBCReconciliationService] Error fetching channels from API: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Check if client data from DB and API are different
     */
    private isClientDataDifferent(dbClient: any, apiClient: any): boolean {
        return (
            dbClient.client_type !== apiClient.client_type ||
            dbClient.status !== apiClient.status ||
            JSON.stringify(dbClient.latest_height) !== JSON.stringify(apiClient.latest_height)
        );
    }

    /**
     * Check if connection data from DB and API are different
     */
    private isConnectionDataDifferent(dbConn: any, apiConn: any): boolean {
        return (
            dbConn.client_id !== apiConn.client_id ||
            dbConn.counterparty_connection_id !== apiConn.counterparty_connection_id ||
            dbConn.counterparty_client_id !== apiConn.counterparty_client_id ||
            dbConn.state !== apiConn.state
        );
    }

    /**
     * Check if channel data from DB and API are different
     */
    private isChannelDataDifferent(dbChannel: any, apiChannel: any): boolean {
        return (
            dbChannel.connection_id !== apiChannel.connection_id ||
            dbChannel.counterparty_channel_id !== apiChannel.counterparty_channel_id ||
            dbChannel.counterparty_port_id !== apiChannel.counterparty_port_id ||
            dbChannel.state !== apiChannel.state ||
            dbChannel.ordering !== apiChannel.ordering
        );
    }

    /**
     * Get LCD endpoint for the given network using BabylonClient
     * For IBC operations, we need to use the LCD/REST endpoint, not RPC
     */
    private getLCDEndpoint(network?: Network): string {
        // We need to use the specific instance for the given network
        const client = BabylonClient.getInstance();
        logger.debug(`[IBCReconciliationService] Using LCD endpoint: ${client.getBaseUrl()} for network: ${network}`);
        // Get the base URL (LCD endpoint) from the BabylonClient
        return client.getBaseUrl();
    }
}
