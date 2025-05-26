import { ChainInfo } from './types';
import { logger } from '../../../utils/logger';

export class ChainConfigService {
  private static instance: ChainConfigService;
  private chainConfigs: Map<string, ChainInfo> = new Map();

  private constructor() {
    this.loadChainConfigs();
  }

  public static getInstance(): ChainConfigService {
    if (!ChainConfigService.instance) {
      ChainConfigService.instance = new ChainConfigService();
    }
    return ChainConfigService.instance;
  }

  private loadChainConfigs(): void {
    // Babylon chains
    this.chainConfigs.set('babylon-mainnet', {
      chain_id: 'bbn-1',
      rpc_url: process.env.BABYLON_RPC_URL || 'https://rpc.babylon.nodestake.top',
      grpc_url: process.env.BABYLON_GRPC_URL || 'https://grpc.babylon.nodestake.top',
      prefix: 'bbn'
    });

    this.chainConfigs.set('babylon-testnet', {
      chain_id: 'bbn-test-3',
      rpc_url: process.env.BABYLON_TESTNET_RPC_URL || 'https://rpc.testnet.babylon.network',
      grpc_url: process.env.BABYLON_TESTNET_GRPC_URL || 'https://grpc.testnet.babylon.network',
      prefix: 'bbn'
    });

    // Cosmos Hub
    this.chainConfigs.set('cosmoshub-4', {
      chain_id: 'cosmoshub-4',
      rpc_url: process.env.COSMOS_RPC_URL || 'https://rpc.cosmos.network',
      grpc_url: process.env.COSMOS_GRPC_URL || 'https://grpc.cosmos.network',
      prefix: 'cosmos'
    });

    // Osmosis
    this.chainConfigs.set('osmosis-1', {
      chain_id: 'osmosis-1',
      rpc_url: process.env.OSMOSIS_RPC_URL || 'https://rpc.osmosis.zone',
      grpc_url: process.env.OSMOSIS_GRPC_URL || 'https://grpc.osmosis.zone',
      prefix: 'osmo'
    });

    // Add more chains as needed
    logger.info('[ChainConfigService] Loaded chain configurations', {
      chains: Array.from(this.chainConfigs.keys())
    });
  }

  public getChainConfig(chainId: string): ChainInfo | null {
    const config = this.chainConfigs.get(chainId);
    if (!config) {
      logger.warn(`[ChainConfigService] Chain configuration not found for ${chainId}`);
      return null;
    }
    return config;
  }

  public getAllChainIds(): string[] {
    return Array.from(this.chainConfigs.keys());
  }

  public addChainConfig(chainId: string, config: ChainInfo): void {
    this.chainConfigs.set(chainId, config);
    logger.info(`[ChainConfigService] Added chain configuration for ${chainId}`);
  }
} 