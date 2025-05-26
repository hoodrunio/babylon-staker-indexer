import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { WebSocketConnectionService } from './WebSocketConnectionService';
import { WebSocketOrchestratorService } from './WebSocketOrchestratorService';
import { WebsocketHealthTracker } from './WebsocketHealthTracker';
import { WebSocketConfigService } from './WebSocketConfigService';
import { BabylonClient } from '../../clients/BabylonClient';

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
    private babylonClient: BabylonClient;
    private network: Network;
    // Removed from constructor, will be used for lazy initialization
    private orchestratorService: WebSocketOrchestratorService | null = null;
    
    private monitorInterval: NodeJS.Timeout | null = null;
    private readonly CHECK_INTERVAL = 60000; // Check every minute
    private readonly MAX_INACTIVE_TIME = 300000; // 5 minutes without block updates is considered inactive
    private readonly INITIAL_DELAY = 10000; // 10 seconds delay before first check
    
    private constructor() {
        this.connectionService = WebSocketConnectionService.getInstance();
        this.configService = WebSocketConfigService.getInstance();
        
        try {
            // Initialize BabylonClient using the network from environment variable
            this.babylonClient = BabylonClient.getInstance();
            this.network = this.babylonClient.getNetwork();
            
            // Initialize the healthTracker after we have set our network
            this.healthTracker = WebsocketHealthTracker.getInstance();
            
            // Debug the network values to ensure they match
            const trackState = this.healthTracker.getNetworkState(this.network);
            logger.info(`[WebSocketHealthMonitor] Initialized with network: ${this.network}`);
            logger.info(`[WebSocketHealthMonitor] Initial health tracker state: ${trackState ? 'Found' : 'Not found'}`);
        } catch (error) {
            logger.error('[WebSocketHealthMonitor] Failed to initialize BabylonClient:', error);
            throw new Error('[WebSocketHealthMonitor] Failed to initialize BabylonClient. Please check your NETWORK environment variable.');
        }
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
     * Check WebSocket connection for the configured network from environment
     */
    private checkAllConnections(): void {
        // In the simplified network approach, we only have one network from environment
        logger.debug(`[WebSocketHealthMonitor] Checking connection status for network: ${this.network}`);
        this.checkConnection(this.network);
    }
    
    /**
     * Check a specific WebSocket connection
     * Note: The network parameter is kept to preserve method signature, but we only use this.network internally
     */
    private async checkConnection(network: Network): Promise<void> {
        try {
            // Always use the network from BabylonClient for consistency
            const connection = this.connectionService.getConnection(this.network);
            
            if (!connection) {
                logger.warn(`[WebSocketHealthMonitor] No connection found for ${this.network}, attempting to reconnect`);
                this.getOrchestratorService().reconnectNetwork(this.network);
                return;
            }
            
            // Check if connection is active
            if (!connection.isConnected()) {
                // Verify connection status again after a small delay to avoid false positives
                // during connection establishment
                setTimeout(() => {
                    const conn = this.connectionService.getConnection(this.network);
                    if (conn && !conn.isConnected()) {
                        logger.warn(`[WebSocketHealthMonitor] Connection for ${this.network} is not connected, reconnecting`);
                        this.getOrchestratorService().reconnectNetwork(this.network);
                    }
                }, 1000);
                return;
            }
            
            // Check if we've received blocks recently
            await this.checkBlockActivity();
            
        } catch (error) {
            logger.error(`[WebSocketHealthMonitor] Error checking connection for ${this.network}:`, error);
        }
    }
    
    /**
     * Check if we've received blocks recently
     * Takes no network parameter as we only use this.network
     */
    private async checkBlockActivity(): Promise<void> {
        try {
            const state = this.healthTracker.getNetworkState(this.network);
            
            if (!state) {
                // This shouldn't happen with properly initialized services
                logger.warn(`[WebSocketHealthMonitor] No state found for configured network ${this.network}`);
                return;
            }
            
            const now = new Date();
            const lastUpdate = state.lastUpdateTime || state.lastConnectionTime;
            const timeSinceLastUpdate = now.getTime() - lastUpdate.getTime();
            
            if (timeSinceLastUpdate > this.MAX_INACTIVE_TIME) {
                logger.warn(`[WebSocketHealthMonitor] No block updates for ${this.network} in ${timeSinceLastUpdate / 1000} seconds, reconnecting`);
                
                // Check current height from API to confirm if there's a real issue
                // With simplified network approach, we use the class's client property directly
                try {
                    const currentHeight = await this.babylonClient.getCurrentHeight();
                    const lastProcessedHeight = state.lastProcessedHeight;
                    
                    if (currentHeight > lastProcessedHeight) {
                        logger.warn(`[WebSocketHealthMonitor] Current height (${currentHeight}) is ahead of last processed height (${lastProcessedHeight}), reconnecting`);
                        this.getOrchestratorService().reconnectNetwork(this.network);
                    } else {
                        logger.info(`[WebSocketHealthMonitor] No new blocks available for ${this.network}, current height: ${currentHeight}`);
                    }
                } catch (error) {
                    logger.error(`[WebSocketHealthMonitor] Error getting current height for ${this.network}:`, error);
                    // Reconnect anyway as we can't confirm if there's a real issue
                    this.getOrchestratorService().reconnectNetwork(this.network);
                }
            }
        } catch (error) {
            logger.error(`[WebSocketHealthMonitor] Error checking block activity for ${this.network}:`, error);
        }
    }
} 