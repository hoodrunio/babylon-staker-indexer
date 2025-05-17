import { logger } from '../../utils/logger';
import { WebSocketConnectionService } from './WebSocketConnectionService';
import { WebSocketConfigService } from './WebSocketConfigService';
import { WebSocketMessageService } from './WebSocketMessageService';
import { WebSocketReconnectionService } from './WebSocketReconnectionService';
import { WebsocketHealthTracker } from '../btc-delegations/WebsocketHealthTracker';
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
    
    // Flag to track reconnection in progress
    private reconnectInProgress: boolean = false;
    
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
        // Connect to the configured network
        this.connect();
        
        // Start health monitoring
        this.healthMonitor.startMonitoring();
    }
    
    private connect(): void {
        const config = this.configService.getConfig();
        if (!config) {
            logger.error(`[WebSocketOrchestrator] WebSocket configuration not found`);
            return;
        }
        
        const wsUrl = config.getWsUrl();
        if (!wsUrl) {
            logger.warn(`[WebSocketOrchestrator] WebSocket URL is not defined, unable to connect`);
            // If BabylonClient exists, log the information
            const client = config.getClient();
            if (client) {
                const network = client.getNetwork();
                logger.info(`[WebSocketOrchestrator] ${network} is configured with baseURL: ${client.getBaseUrl()} and rpcURL: ${client.getRpcUrl()}`);
                logger.info(`[WebSocketOrchestrator] But WebSocket URL is missing. Please check BABYLON_WS_URL in your .env file`);
            }
            return;
        }
        
        logger.info(`[WebSocketOrchestrator] Connecting to WebSocket at ${wsUrl}`);
        
        // Create event handlers
        const eventHandlers: IWebSocketEventHandlers = {
            onOpen: this.handleOpen.bind(this),
            onMessage: this.handleMessage.bind(this),
            onClose: this.handleClose.bind(this),
            onError: this.handleError.bind(this)
        };
        
        // Create and connect
        const connection = this.connectionService.createConnection(wsUrl, eventHandlers);
        connection.connect();
    }
    
    private async handleOpen(): Promise<void> {
        logger.info(`Connected to websocket`);
        this.reconnectionService.resetAttempts();
        
        try {
            // Start historical sync
            const config = this.configService.getConfig();
            const client = config?.getClient();
            if (client) {
                await this.validatorHistoricalSync.startSync(client);
            }
            
            // Send subscriptions
            this.sendSubscriptions();
        } catch (error) {
            logger.error(`[WebSocket] Error during connection setup:`, error);
        }
    }
    
    private sendSubscriptions(): void {
        const connection = this.connectionService.getConnection();
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
    
    private async handleMessage(data: Buffer): Promise<void> {
        try {
            const message = JSON.parse(data.toString());
            await this.messageService.processMessage(message);
        } catch (error) {
            logger.error(`Error handling websocket message:`, error);
        }
    }
    
    private async handleClose(): Promise<void> {
        logger.info(`Websocket connection closed`);
        this.healthTracker.markDisconnected();
        
        const config = this.configService.getConfig();
        await this.reconnectionService.handleReconnect(
            config?.getClient(),
            () => this.reconnect()
        );
    }
    
    private handleError(error: Error): void {
        logger.error(`Websocket error:`, error);
        const connection = this.connectionService.getConnection();
        if (connection) {
            connection.disconnect();
        }
    }
    
    public reconnect(): void {
        this.connectionService.removeConnection();
        this.connect();
    }
    
    public stop(): void {
        this.connectionService.disconnectAll();
        this.healthMonitor.stopMonitoring();
    }

    /**
     * Force a reconnection to the WebSocket
     */
    public reconnectNow(): void {
        // If there is already a reconnection process, cancel it
        if (this.reconnectInProgress) {
            logger.debug(`[WebSocketOrchestrator] Already reconnecting, skipping duplicate request`);
            return;
        }

        try {
            // Set the flag
            this.reconnectInProgress = true;
            
            logger.info(`[WebSocketOrchestrator] Manually reconnecting`);
            this.connectionService.removeConnection();
            
            // add a short wait before reconnecting
            setTimeout(() => {
                this.connect();
                // Remove the flag
                this.reconnectInProgress = false;
            }, 1000);
        } catch (error) {
            // Remove the flag in case of error
            this.reconnectInProgress = false;
            logger.error(`[WebSocketOrchestrator] Error during reconnection:`, error);
        }
    }
}