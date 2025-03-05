import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { WebSocketConnectionService } from './WebSocketConnectionService';
import { WebSocketConfigService } from './WebSocketConfigService';
import { WebSocketMessageService } from './WebSocketMessageService';
import { WebSocketReconnectionService } from './WebSocketReconnectionService';
import { WebsocketHealthTracker } from '../btc-delegations/WebsocketHealthTracker';
import { ValidatorHistoricalSyncService } from '../validator/ValidatorHistoricalSyncService';
import { IWebSocketEventHandlers } from './interfaces';

// Main WebSocket Orchestrator Service
export class WebSocketOrchestratorService {
    private static instance: WebSocketOrchestratorService | null = null;
    private connectionService: WebSocketConnectionService;
    private configService: WebSocketConfigService;
    private messageService: WebSocketMessageService;
    private reconnectionService: WebSocketReconnectionService;
    private healthTracker: WebsocketHealthTracker;
    private validatorHistoricalSync: ValidatorHistoricalSyncService;
    
    private constructor() {
        // Initialize services
        this.connectionService = WebSocketConnectionService.getInstance();
        this.configService = WebSocketConfigService.getInstance();
        this.messageService = WebSocketMessageService.getInstance();
        this.reconnectionService = WebSocketReconnectionService.getInstance();
        this.healthTracker = WebsocketHealthTracker.getInstance();
        this.validatorHistoricalSync = ValidatorHistoricalSyncService.getInstance();
    }
    
    public static getInstance(): WebSocketOrchestratorService {
        if (!WebSocketOrchestratorService.instance) {
            WebSocketOrchestratorService.instance = new WebSocketOrchestratorService();
        }
        return WebSocketOrchestratorService.instance;
    }
    
    public startListening(): void {
        // Connect to all configured networks
        const networks = this.configService.getAllNetworks();
        for (const network of networks) {
            this.connectToNetwork(network);
        }
    }
    
    private connectToNetwork(network: Network): void {
        const config = this.configService.getNetworkConfig(network);
        if (!config) {
            logger.error(`Network configuration for ${network} not found`);
            return;
        }
        
        const wsUrl = config.getWsUrl();
        if (!wsUrl) {
            logger.error(`WebSocket URL for ${network} is not defined`);
            return;
        }
        
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
            const config = this.configService.getNetworkConfig(network);
            const client = config?.getClient();
            if (client) {
                await this.validatorHistoricalSync.startSync(network, client);
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
        
        const config = this.configService.getNetworkConfig(network);
        await this.reconnectionService.handleReconnect(
            network, 
            config?.getClient(),
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
    }
} 