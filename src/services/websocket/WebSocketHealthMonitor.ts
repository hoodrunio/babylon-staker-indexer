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
     * Check WebSocket connection
     */
    private checkAllConnections(): void {
        logger.debug(`[WebSocketHealthMonitor] Checking WebSocket connection status`);
        this.checkConnection();
    }
    
    /**
     * Check the WebSocket connection
     */
    private async checkConnection(): Promise<void> {
        try {
            const connection = this.connectionService.getConnection();
            
            if (!connection) {
                logger.warn(`[WebSocketHealthMonitor] No connection found, attempting to reconnect`);
                // Use the public reconnect method
                this.getOrchestratorService().reconnect();
                return;
            }
            
            // Check if connection is active
            if (!connection.isConnected()) {
                // Verify connection status again after a small delay to avoid false positives
                // during connection establishment
                setTimeout(() => {
                    const conn = this.connectionService.getConnection();
                    if (conn && !conn.isConnected()) {
                        logger.warn(`[WebSocketHealthMonitor] Connection is not connected, reconnecting`);
                        this.getOrchestratorService().reconnect();
                    }
                }, 1000);
                return;
            }
            
            // Check if we've received blocks recently
            await this.checkBlockActivity();
            
        } catch (error) {
            logger.error(`[WebSocketHealthMonitor] Error checking connection:`, error);
        }
    }
    
    /**
     * Check if we've received blocks recently
     */
    private async checkBlockActivity(): Promise<void> {
        try {
            const state = this.healthTracker.getState();
            
            if (!state) {
                logger.warn(`[WebSocketHealthMonitor] No state found`);
                return;
            }
            
            const now = new Date();
            const lastUpdate = state.lastUpdateTime || state.lastConnectionTime;
            const timeSinceLastUpdate = now.getTime() - lastUpdate.getTime();
            
            if (timeSinceLastUpdate > this.MAX_INACTIVE_TIME) {
                logger.warn(`[WebSocketHealthMonitor] No block updates in ${timeSinceLastUpdate / 1000} seconds, reconnecting`);
                
                // Check current height from API to confirm if there's a real issue
                const config = this.configService.getConfig();
                const client = config?.getClient();
                
                if (client) {
                    try {
                        const currentHeight = await client.getCurrentHeight();
                        const lastProcessedHeight = state.lastProcessedHeight;
                        
                        if (currentHeight > lastProcessedHeight) {
                            logger.warn(`[WebSocketHealthMonitor] Current height (${currentHeight}) is ahead of last processed height (${lastProcessedHeight}), reconnecting`);
                            this.getOrchestratorService().reconnect();
                        } else {
                            logger.info(`[WebSocketHealthMonitor] No new blocks available, current height: ${currentHeight}`);
                        }
                    } catch (error) {
                        logger.error(`[WebSocketHealthMonitor] Error getting current height:`, error);
                        // Reconnect anyway as we can't confirm if there's a real issue
                        this.getOrchestratorService().reconnect();
                    }
                } else {
                    // No client available, reconnect anyway
                    this.getOrchestratorService().reconnect();
                }
            }
        } catch (error) {
            logger.error(`[WebSocketHealthMonitor] Error checking block activity:`, error);
        }
    }
} 