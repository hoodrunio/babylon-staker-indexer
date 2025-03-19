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
    private healthTracker: WebsocketHealthTracker;
    private configService: WebSocketConfigService;
    // Removed from constructor, will be used for lazy initialization
    private orchestratorService: WebSocketOrchestratorService | null = null;
    
    private monitorInterval: NodeJS.Timeout | null = null;
    private readonly CHECK_INTERVAL = 60000; // Check every minute
    private readonly MAX_INACTIVE_TIME = 300000; // 5 minutes without block updates is considered inactive
    private readonly INITIAL_DELAY = 10000; // 10 seconds delay before first check
    
    private constructor() {
        this.connectionService = WebSocketConnectionService.getInstance();
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
     * Get Orchestrator service lazily to avoid circular dependency
     */
    private getOrchestratorService(): WebSocketOrchestratorService {
        if (!this.orchestratorService) {
            this.orchestratorService = WebSocketOrchestratorService.getInstance();
        }
        return this.orchestratorService;
    }
    
    /**
     * Start monitoring WebSocket connections
     */
    public startMonitoring(): void {
        logger.info('[WebSocketHealthMonitor] Starting WebSocket health monitoring');
        
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
        }
        
        // Wait before first check to allow connections to establish
        logger.info(`[WebSocketHealthMonitor] Initial check will run after ${this.INITIAL_DELAY/1000} seconds`);
        
        setTimeout(() => {
            // Run initial check after delay
            this.checkAllConnections();
            
            // Start periodic health checks
            this.monitorInterval = setInterval(() => {
                this.checkAllConnections();
            }, this.CHECK_INTERVAL);
            
            logger.info(`[WebSocketHealthMonitor] Health monitoring started, will check every ${this.CHECK_INTERVAL/1000} seconds`);
        }, this.INITIAL_DELAY);
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
        logger.debug(`[WebSocketHealthMonitor] Checking connection status for ${networks.length} networks`);
        
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
                this.getOrchestratorService().reconnectNetwork(network);
                return;
            }
            
            // Check if connection is active
            if (!connection.isConnected()) {
                // Verify connection status again after a small delay to avoid false positives
                // during connection establishment
                setTimeout(() => {
                    const conn = this.connectionService.getConnection(network);
                    if (conn && !conn.isConnected()) {
                        logger.warn(`[WebSocketHealthMonitor] Connection for ${network} is not connected, reconnecting`);
                        this.getOrchestratorService().reconnectNetwork(network);
                    }
                }, 1000);
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
                            this.getOrchestratorService().reconnectNetwork(network);
                        } else {
                            logger.info(`[WebSocketHealthMonitor] No new blocks available for ${network}, current height: ${currentHeight}`);
                        }
                    } catch (error) {
                        logger.error(`[WebSocketHealthMonitor] Error getting current height for ${network}:`, error);
                        // Reconnect anyway as we can't confirm if there's a real issue
                        this.getOrchestratorService().reconnectNetwork(network);
                    }
                } else {
                    // No client available, reconnect anyway
                    this.getOrchestratorService().reconnectNetwork(network);
                }
            }
        } catch (error) {
            logger.error(`[WebSocketHealthMonitor] Error checking block activity for ${network}:`, error);
        }
    }
} 