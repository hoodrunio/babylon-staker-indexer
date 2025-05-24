import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';

/**
 * Chain Configuration Service
 * Manages chain-specific configurations in a maintainable way
 */
export interface ChainConfig {
    chainId: string;
    chainName: string;
    isHomeChain: boolean;
    network: Network;
}

export class ChainConfigService {
    private static instance: ChainConfigService | null = null;
    
    // Home chain configurations per network
    private readonly homeChainConfigs: Record<string, ChainConfig> = {
        [Network.MAINNET]: {
            chainId: 'bbn-1',
            chainName: 'Babylon Genesis',
            isHomeChain: true,
            network: Network.MAINNET
        },
        [Network.TESTNET]: {
            chainId: 'bbn-test-5', 
            chainName: 'Babylon Testnet',
            isHomeChain: true,
            network: Network.TESTNET
        }
    };

    private constructor() {}

    public static getInstance(): ChainConfigService {
        if (!ChainConfigService.instance) {
            ChainConfigService.instance = new ChainConfigService();
        }
        return ChainConfigService.instance;
    }

    /**
     * Get home chain configuration for the given network
     */
    public getHomeChainConfig(network: Network): ChainConfig {
        const config = this.homeChainConfigs[network.toString()];
        if (!config) {
            logger.warn(`[ChainConfigService] No home chain config found for network: ${network}, using mainnet config`);
            return this.homeChainConfigs[Network.MAINNET];
        }
        return config;
    }

    /**
     * Check if a chain ID is the home chain for the given network
     */
    public isHomeChain(chainId: string, network: Network): boolean {
        const homeConfig = this.getHomeChainConfig(network);
        return chainId === homeConfig.chainId;
    }

    /**
     * Get external (non-home) chains from a list of chain IDs
     */
    public filterExternalChains(chainIds: string[], network: Network): string[] {
        const homeChainId = this.getHomeChainConfig(network).chainId;
        return chainIds.filter(chainId => 
            chainId && 
            chainId !== 'unknown' && 
            chainId !== homeChainId
        );
    }

    /**
     * Validate if a transfer involves the home chain
     */
    public isHomeChainTransfer(sourceChain: string, destChain: string, network: Network): {
        isHomeChainInvolved: boolean;
        externalChain: string | null;
        isOutgoingFromHome: boolean;
    } {
        const homeChainId = this.getHomeChainConfig(network).chainId;
        
        if (sourceChain === homeChainId && destChain !== homeChainId) {
            // Home -> External (outgoing)
            return {
                isHomeChainInvolved: true,
                externalChain: destChain,
                isOutgoingFromHome: true
            };
        } else if (sourceChain !== homeChainId && destChain === homeChainId) {
            // External -> Home (incoming)
            return {
                isHomeChainInvolved: true,
                externalChain: sourceChain,
                isOutgoingFromHome: false
            };
        }
        
        // No home chain involvement
        return {
            isHomeChainInvolved: false,
            externalChain: null,
            isOutgoingFromHome: false
        };
    }

    /**
     * Get all supported networks
     */
    public getSupportedNetworks(): Network[] {
        return Object.keys(this.homeChainConfigs).map(key => key as Network);
    }

    /**
     * Reset singleton instance (useful for testing)
     */
    public static resetInstance(): void {
        ChainConfigService.instance = null;
    }
} 