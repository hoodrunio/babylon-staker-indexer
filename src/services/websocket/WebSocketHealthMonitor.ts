import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { WebSocketConnectionService } from './WebSocketConnectionService';
import { WebSocketOrchestratorService } from './WebSocketOrchestratorService';
import { WebsocketHealthTracker } from '../btc-delegations/WebsocketHealthTracker';
import { WebSocketConfigService } from './WebSocketConfigService';

/**
 * WebSocket Health Monitor Service
 * 
 * This service monitors the health of WebSocket connections and ensures they are working properly.
 * It periodically checks the connection status and reconnects if necessary.
 */
export class WebSocketHealthMonitor {
    private static instance: WebSocketHealthMonitor | null = null;
    private connectionService: WebSocketConnectionService;
    private orchestratorService: WebSocketOrchestratorService;
    private healthTracker: WebsocketHealthTracker;
    private configService: WebSocketConfigService;
    
    private monitorInterval: NodeJS.Timeout | null = null;
    private readonly CHECK_INTERVAL = 60000; // Check every minute
    private readonly MAX_INACTIVE_TIME = 300000; // 5 minutes without block updates is considered inactive
    
    private constructor() {
        this.connectionService = WebSocketConnectionService.getInstance();
        this.orchestratorService = WebSocketOrchestratorService.getInstance();
        this.healthTracker = WebsocketHealthTracker.getInstance();
        this.configService = WebSocketConfigService.getInstance();
    }
    
    public static getInstance(): WebSocketHealthMonitor {
        if (!WebSocketHealthMonitor.instance) {
            WebSocketHealthMonitor.instance = new WebSocketHealthMonitor();
        }
        return WebSocketHealthMonitor.instance;
    }
    
    /**
     * Start monitoring WebSocket connections
     */
    public startMonitoring(): void {
        logger.info('[WebSocketHealthMonitor] Starting WebSocket health monitoring');
        
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
        }
        
        // Start periodic health checks
        this.monitorInterval = setInterval(() => {
            this.checkAllConnections();
        }, this.CHECK_INTERVAL);
        
        // Run an initial check
        this.checkAllConnections();
    }
    
    /**
     * Stop monitoring WebSocket connections
     */
    public stopMonitoring(): void {
        logger.info('[WebSocketHealthMonitor] Stopping WebSocket health monitoring');
        
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }
    
    /**
     * Check all WebSocket connections
     */
    private checkAllConnections(): void {
        const networks = this.configService.getAllNetworks();
        
        for (const network of networks) {
            this.checkConnection(network);
        }
    }
    
    /**
     * Check a specific WebSocket connection
     */
    private async checkConnection(network: Network): Promise<void> {
        try {
            const connection = this.connectionService.getConnection(network);
            
            if (!connection) {
                logger.warn(`[WebSocketHealthMonitor] No connection found for ${network}, attempting to reconnect`);
                this.orchestratorService.reconnectNetwork(network);
                return;
            }
            
            // Check if connection is active
            if (!connection.isConnected()) {
                logger.warn(`[WebSocketHealthMonitor] Connection for ${network} is not connected, reconnecting`);
                this.orchestratorService.reconnectNetwork(network);
                return;
            }
            
            // Check if we've received blocks recently
            await this.checkBlockActivity(network);
            
        } catch (error) {
            logger.error(`[WebSocketHealthMonitor] Error checking connection for ${network}:`, error);
        }
    }
    
    /**
     * Check if we've received blocks recently
     */
    private async checkBlockActivity(network: Network): Promise<void> {
        try {
            const state = this.healthTracker.getNetworkState(network);
            
            if (!state) {
                logger.warn(`[WebSocketHealthMonitor] No state found for ${network}`);
                return;
            }
            
            const now = new Date();
            const lastUpdate = state.lastUpdateTime || state.lastConnectionTime;
            const timeSinceLastUpdate = now.getTime() - lastUpdate.getTime();
            
            if (timeSinceLastUpdate > this.MAX_INACTIVE_TIME) {
                logger.warn(`[WebSocketHealthMonitor] No block updates for ${network} in ${timeSinceLastUpdate / 1000} seconds, reconnecting`);
                
                // Check current height from API to confirm if there's a real issue
                const config = this.configService.getNetworkConfig(network);
                const client = config?.getClient();
                
                if (client) {
                    try {
                        const currentHeight = await client.getCurrentHeight();
                        const lastProcessedHeight = state.lastProcessedHeight;
                        
                        if (currentHeight > lastProcessedHeight) {
                            logger.warn(`[WebSocketHealthMonitor] Current height (${currentHeight}) is ahead of last processed height (${lastProcessedHeight}), reconnecting`);
                            this.orchestratorService.reconnectNetwork(network);
                        } else {
                            logger.info(`[WebSocketHealthMonitor] No new blocks available for ${network}, current height: ${currentHeight}`);
                        }
                    } catch (error) {
                        logger.error(`[WebSocketHealthMonitor] Error getting current height for ${network}:`, error);
                        // Reconnect anyway as we can't confirm if there's a real issue
                        this.orchestratorService.reconnectNetwork(network);
                    }
                } else {
                    // No client available, reconnect anyway
                    this.orchestratorService.reconnectNetwork(network);
                }
            }
        } catch (error) {
            logger.error(`[WebSocketHealthMonitor] Error checking block activity for ${network}:`, error);
        }
    }
} 