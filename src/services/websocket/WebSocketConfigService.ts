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
        // If BabylonClient is available, get WebSocket URL from it
        if (this.client) {
            try {
                return this.client.getWsEndpoint();
            } catch (err) {
                logger.warn(`[WebSocketConfig] Error getting WebSocket endpoint for ${this.network}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        
        // If BabylonClient is not available or there is an error, try the old method (for backward compatibility)
        return this.network === Network.MAINNET 
            ? process.env.BABYLON_WS_URL 
            : process.env.BABYLON_TESTNET_WS_URL;
    }

    getClient(): BabylonClient | undefined {
        return this.client;
    }
}

// WebSocket Configuration Service
export class WebSocketConfigService {
    private static instance: WebSocketConfigService | null = null;
    private networkConfigs: Map<Network, INetworkConfig> = new Map();
    
    private constructor() {
        this.initializeNetworkConfigs();
    }
    
    public static getInstance(): WebSocketConfigService {
        if (!WebSocketConfigService.instance) {
            WebSocketConfigService.instance = new WebSocketConfigService();
        }
        return WebSocketConfigService.instance;
    }
    
    private initializeNetworkConfigs(): void {
        let configuredNetworkCount = 0;
        
        // Add mainnet configuration if exists
        try {
            const client = BabylonClient.getInstance(Network.MAINNET);
            // Get base URL, RPC URL and WS URL from BabylonClient and check
            const baseUrl = client.getBaseUrl();
            const rpcUrl = client.getRpcUrl();
            const wsUrl = client.getWsEndpoint();
            
            if (baseUrl && rpcUrl) {
                const networkConfig = new NetworkConfig(Network.MAINNET, client);
                this.networkConfigs.set(Network.MAINNET, networkConfig);
                configuredNetworkCount++;
                
                // Log WS URL status
                if (wsUrl) {
                    logger.info(`[WebSocketConfig] Mainnet initialized with WebSocket URL: ${wsUrl}`);
                } else {
                    logger.warn('[WebSocketConfig] Mainnet initialized but WebSocket URL is not available');
                }
                
                logger.info('[WebSocketConfig] Mainnet client initialized successfully');
            } else {
                logger.info('[WebSocketConfig] Mainnet is not configured properly, skipping');
            }
        } catch (err) {
            logger.warn(`[WebSocketConfig] Failed to initialize Mainnet client: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Add testnet configuration if exists
        try {
            const client = BabylonClient.getInstance(Network.TESTNET);
            // Get base URL, RPC URL and WS URL from BabylonClient and check
            const baseUrl = client.getBaseUrl();
            const rpcUrl = client.getRpcUrl();
            const wsUrl = client.getWsEndpoint();
            
            if (baseUrl && rpcUrl) {
                const networkConfig = new NetworkConfig(Network.TESTNET, client);
                this.networkConfigs.set(Network.TESTNET, networkConfig);
                configuredNetworkCount++;
                
                // Log WS URL status
                if (wsUrl) {
                    logger.info(`[WebSocketConfig] Testnet initialized with WebSocket URL: ${wsUrl}`);
                } else {
                    logger.warn('[WebSocketConfig] Testnet initialized but WebSocket URL is not available');
                }
                
                logger.info('[WebSocketConfig] Testnet client initialized successfully');
            } else {
                logger.info('[WebSocketConfig] Testnet is not configured properly, skipping');
            }
        } catch (err) {
            logger.warn(`[WebSocketConfig] Failed to initialize Testnet client: ${err instanceof Error ? err.message : String(err)}`);
        }

        // At least one network must be configured
        if (configuredNetworkCount === 0) {
            throw new Error('[WebSocketConfig] No network configurations found. Please configure at least one network (MAINNET or TESTNET)');
        }
    }
    
    public getNetworkConfig(network: Network): INetworkConfig | undefined {
        return this.networkConfigs.get(network);
    }
    
    public getAllNetworks(): Network[] {
        return Array.from(this.networkConfigs.keys());
    }
    
    public hasNetworkConfig(network: Network): boolean {
        return this.networkConfigs.has(network);
    }
} 