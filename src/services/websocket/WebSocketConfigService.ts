import { BabylonClient } from '../../clients/BabylonClient';
import { logger } from '../../utils/logger';
import { IWebSocketConfig } from './interfaces';

// WebSocket configuration implementation
export class WebSocketConfig implements IWebSocketConfig {
    constructor(
        private client?: BabylonClient
    ) {}

    getWsUrl(): string | undefined {
        // If BabylonClient is available, get WebSocket URL from it
        if (this.client) {
            try {
                return this.client.getWsEndpoint();
            } catch (err) {
                const network = this.client.getNetwork();
                logger.warn(`[WebSocketConfig] Error getting WebSocket endpoint: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        
        // If BabylonClient is not available or there is an error, try to get from environment
        return process.env.BABYLON_WS_URL;
    }

    getClient(): BabylonClient | undefined {
        return this.client;
    }
}

// WebSocket Configuration Service
export class WebSocketConfigService {
    private static instance: WebSocketConfigService | null = null;
    private config: IWebSocketConfig | null = null;
    
    private constructor() {
        this.initializeConfig();
    }
    
    public static getInstance(): WebSocketConfigService {
        if (!WebSocketConfigService.instance) {
            WebSocketConfigService.instance = new WebSocketConfigService();
        }
        return WebSocketConfigService.instance;
    }
    
    private initializeConfig(): void {
        try {
            // Get the client from BabylonClient singleton
            const client = BabylonClient.getInstance();
            const network = client.getNetwork();
            const baseUrl = client.getBaseUrl();
            const rpcUrl = client.getRpcUrl();
            const wsUrl = client.getWsEndpoint();
            
            if (baseUrl && rpcUrl) {
                this.config = new WebSocketConfig(client);
                
                // Log WS URL status
                if (wsUrl) {
                    logger.info(`[WebSocketConfig] Initialized with WebSocket URL: ${wsUrl} for network ${network}`);
                } else {
                    logger.warn(`[WebSocketConfig] Initialized but WebSocket URL is not available for network ${network}`);
                    logger.info(`[WebSocketConfig] Please check BABYLON_WS_URL in your .env file`);
                }
                
                logger.info(`[WebSocketConfig] Client initialized successfully from environment configuration`);
            } else {
                throw new Error(`Base URL or RPC URL not configured properly`);
            }
        } catch (error) {
            logger.error(`[WebSocketConfig] Failed to initialize WebSocket configuration: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error(`Failed to initialize WebSocket configuration: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    public getConfig(): IWebSocketConfig | null {
        return this.config;
    }
}
