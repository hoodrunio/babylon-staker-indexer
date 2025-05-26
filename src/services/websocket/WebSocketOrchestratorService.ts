import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { WebSocketConnectionService } from './WebSocketConnectionService';
import { WebSocketConfigService } from './WebSocketConfigService';
import { WebSocketMessageService } from './WebSocketMessageService';
import { WebSocketReconnectionService } from './WebSocketReconnectionService';
import { WebsocketHealthTracker } from './WebsocketHealthTracker';
import { ValidatorHistoricalSyncService } from '../validator/ValidatorHistoricalSyncService';
import { IWebSocketEventHandlers } from './interfaces';
import { WebSocketHealthMonitor } from './WebSocketHealthMonitor';

// Main WebSocket Orchestrator Service
export class WebSocketOrchestratorService {
    private static instance: WebSocketOrchestratorService | null = null;
    private connectionService: WebSocketConnectionService;
    private configService: WebSocketConfigService;
    private messageService: WebSocketMessageService;
    private reconnectionService: WebSocketReconnectionService;
    private healthTracker: WebsocketHealthTracker;
    private validatorHistoricalSync: ValidatorHistoricalSyncService;
    private healthMonitor: WebSocketHealthMonitor;
    
    // Map to track reconnection locks
    private reconnectLocks: Map<Network, boolean> = new Map();
    
    private constructor() {
        // Initialize services
        this.connectionService = WebSocketConnectionService.getInstance();
        this.configService = WebSocketConfigService.getInstance();
        this.messageService = WebSocketMessageService.getInstance();
        this.reconnectionService = WebSocketReconnectionService.getInstance();
        this.healthTracker = WebsocketHealthTracker.getInstance();
        this.validatorHistoricalSync = ValidatorHistoricalSyncService.getInstance();
        this.healthMonitor = WebSocketHealthMonitor.getInstance();
    }
    
    public static getInstance(): WebSocketOrchestratorService {
        if (!WebSocketOrchestratorService.instance) {
            WebSocketOrchestratorService.instance = new WebSocketOrchestratorService();
        }
        return WebSocketOrchestratorService.instance;
    }
    
    public startListening(): void {
        // Connect to the single configured network from environment
        const network = this.configService.getNetwork();
        this.connectToNetwork(network);
        
        // Start health monitoring
        this.healthMonitor.startMonitoring();
    }
    
    private connectToNetwork(network: Network): void {
        const config = this.configService.getNetworkConfig();
        if (!config) {
            logger.error(`[WebSocketOrchestrator] Network configuration not found`);
            return;
        }
        
        const wsUrl = config.getWsUrl();
        if (!wsUrl) {
            logger.warn(`[WebSocketOrchestrator] WebSocket URL for ${network} is not defined, skipping this network`);
            // If BabylonClient exists, log the information
            const client = config.getClient();
            if (client) {
                logger.info(`[WebSocketOrchestrator] ${network} is configured with baseURL: ${client.getBaseUrl()} and rpcURL: ${client.getRpcUrl()}`);
                logger.info(`[WebSocketOrchestrator] But WebSocket URL is missing. Please check BABYLON_WS_URLS or BABYLON_TESTNET_WS_URLS in your .env file`);
            }
            return;
        }
        
        logger.info(`[WebSocketOrchestrator] Connecting to ${network} WebSocket at ${wsUrl}`);
        
        // Create event handlers
        const eventHandlers: IWebSocketEventHandlers = {
            onOpen: this.handleOpen.bind(this),
            onMessage: this.handleMessage.bind(this),
            onClose: this.handleClose.bind(this),
            onError: this.handleError.bind(this)
        };
        
        // Create and connect
        const connection = this.connectionService.createConnection(wsUrl, network, eventHandlers);
        connection.connect();
    }
    
    private async handleOpen(network: Network): Promise<void> {
        logger.info(`Connected to ${network} websocket`);
        this.reconnectionService.resetAttempts(network);
        
        try {
            // Start historical sync
            const config = this.configService.getNetworkConfig();
            const client = config?.getClient();
            if (client) {
                await this.validatorHistoricalSync.startSync(network);
            }
            
            // Send subscriptions
            this.sendSubscriptions(network);
        } catch (error) {
            logger.error(`[WebSocket] Error during connection setup for ${network}:`, error);
        }
    }
    
    private sendSubscriptions(network: Network): void {
        const connection = this.connectionService.getConnection(network);
        if (!connection) return;
        
        const subscriptions = this.messageService.getSubscriptions();
        for (const subscription of subscriptions) {
            const message = {
                jsonrpc: '2.0',
                method: 'subscribe',
                id: subscription.getId(),
                params: {
                    query: subscription.getQuery()
                }
            };
            
            connection.send(message);
        }
    }
    
    private async handleMessage(data: Buffer, network: Network): Promise<void> {
        try {
            const message = JSON.parse(data.toString());
            await this.messageService.processMessage(message, network);
        } catch (error) {
            logger.error(`Error handling ${network} websocket message:`, error);
        }
    }
    
    private async handleClose(network: Network): Promise<void> {
        logger.info(`${network} websocket connection closed`);
        this.healthTracker.markDisconnected(network);
        
        const config = this.configService.getNetworkConfig();
        await this.reconnectionService.handleReconnect(
            network, 
            () => this.reconnect(network)
        );
    }
    
    private handleError(error: Error, network: Network): void {
        logger.error(`${network} websocket error:`, error);
        const connection = this.connectionService.getConnection(network);
        if (connection) {
            connection.disconnect();
        }
    }
    
    private reconnect(network: Network): void {
        this.connectionService.removeConnection(network);
        this.connectToNetwork(network);
    }
    
    public stop(): void {
        this.connectionService.disconnectAll();
        this.healthMonitor.stopMonitoring();
    }

    /**
     * Reconnect to a specific network
     * @param network The network to reconnect to
     */
    public reconnectNetwork(network: Network): void {
        // If there is already a reconnection process for this network, cancel it
        if (this.reconnectLocks.get(network)) {
            logger.debug(`[WebSocketOrchestrator] Already reconnecting to ${network}, skipping duplicate request`);
            return;
        }

        try {
            // Set the lock
            this.reconnectLocks.set(network, true);
            
            logger.info(`[WebSocketOrchestrator] Manually reconnecting to ${network}`);
            this.connectionService.removeConnection(network);
            
            // add a short wait before reconnecting
            setTimeout(() => {
                this.connectToNetwork(network);
                // Remove the lock
                this.reconnectLocks.set(network, false);
            }, 1000);
        } catch (error) {
            // Remove the lock in case of error
            this.reconnectLocks.set(network, false);
            logger.error(`[WebSocketOrchestrator] Error during reconnection to ${network}:`, error);
        }
    }
}