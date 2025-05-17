import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { logger } from '../../utils/logger';
import { INetworkConfig } from './interfaces';

// Network configuration implementation
export class NetworkConfig implements INetworkConfig {
    constructor(
        private network: Network,
        private client?: BabylonClient
    ) {}

    getNetwork(): Network {
        return this.network;
    }

    getWsUrl(): string | undefined {
        // Only get WebSocket URL from BabylonClient
        if (this.client) {
            try {
                return this.client.getWsEndpoint();
            } catch (err) {
                logger.warn(`[WebSocketConfig] Error getting WebSocket endpoint for ${this.network}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        
        // If no client is available or there was an error, return undefined
        logger.warn(`[WebSocketConfig] No BabylonClient available, cannot determine WebSocket URL`);
        return undefined;
    }

    getClient(): BabylonClient | undefined {
        return this.client;
    }
}

// WebSocket Configuration Service
export class WebSocketConfigService {
    private static instance: WebSocketConfigService | null = null;
    private networkConfig!: INetworkConfig;
    private network!: Network;
    
    private constructor() {
        this.initializeNetworkConfig();
    }
    
    public static getInstance(): WebSocketConfigService {
        if (!WebSocketConfigService.instance) {
            WebSocketConfigService.instance = new WebSocketConfigService();
        }
        return WebSocketConfigService.instance;
    }
    
    private initializeNetworkConfig(): void {
        try {
            // Initialize BabylonClient using the network from environment variable
            const client = BabylonClient.getInstance();
            this.network = client.getNetwork();
            
            // Get base URL, RPC URL and WS URL from BabylonClient
            const baseUrl = client.getBaseUrl();
            const rpcUrl = client.getRpcUrl();
            const wsUrl = client.getWsEndpoint();
            
            if (baseUrl && rpcUrl) {
                this.networkConfig = new NetworkConfig(this.network, client);
                
                // Log WS URL status
                if (wsUrl) {
                    logger.info(`[WebSocketConfig] ${this.network} initialized with WebSocket URL: ${wsUrl}`);
                } else {
                    logger.warn(`[WebSocketConfig] ${this.network} initialized but WebSocket URL is not available`);
                }
                
                logger.info(`[WebSocketConfig] ${this.network} client initialized successfully`);
            } else {
                throw new Error(`[WebSocketConfig] ${this.network} is not configured properly - missing URLs`);
            }
        } catch (err) {
            logger.error(`[WebSocketConfig] Failed to initialize BabylonClient: ${err instanceof Error ? err.message : String(err)}`);
            throw new Error('[WebSocketConfig] Failed to initialize BabylonClient. Please check your NETWORK environment variable.');
        }
    }
    
    public getNetworkConfig(): INetworkConfig {
        return this.networkConfig;
    }
    
    public getNetwork(): Network {
        return this.network;
    }
    
    public hasNetworkConfig(): boolean {
        return !!this.networkConfig;
    }
} 