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
        // Add mainnet configuration if exists
        try {
            if (process.env.BABYLON_NODE_URL && process.env.BABYLON_RPC_URL) {
                const client = BabylonClient.getInstance(Network.MAINNET);
                this.networkConfigs.set(
                    Network.MAINNET, 
                    new NetworkConfig(Network.MAINNET, client)
                );
                logger.info('[WebSocketConfig] Mainnet client initialized successfully');
            } else {
                logger.info('[WebSocketConfig] Mainnet is not configured, skipping');
            }
        } catch (error) {
            logger.warn('[WebSocketConfig] Failed to initialize Mainnet client:', error);
        }

        // Add testnet configuration if exists
        try {
            if (process.env.BABYLON_TESTNET_NODE_URL && process.env.BABYLON_TESTNET_RPC_URL) {
                const client = BabylonClient.getInstance(Network.TESTNET);
                this.networkConfigs.set(
                    Network.TESTNET, 
                    new NetworkConfig(Network.TESTNET, client)
                );
                logger.info('[WebSocketConfig] Testnet client initialized successfully');
            } else {
                logger.info('[WebSocketConfig] Testnet is not configured, skipping');
            }
        } catch (error) {
            logger.warn('[WebSocketConfig] Failed to initialize Testnet client:', error);
        }

        // At least one network must be configured
        if (this.networkConfigs.size === 0) {
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