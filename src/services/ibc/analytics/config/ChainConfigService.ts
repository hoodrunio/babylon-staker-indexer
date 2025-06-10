import { Network } from '../../../../types/finality';

/**
 * Chain Configuration Service
 * Provides chain-specific configuration and utilities
 */
export class ChainConfigService {
    private static instance: ChainConfigService | null = null;

    private constructor() {}

    public static getInstance(): ChainConfigService {
        if (!ChainConfigService.instance) {
            ChainConfigService.instance = new ChainConfigService();
        }
        return ChainConfigService.instance;
    }

    /**
     * Check if a chain ID is the home chain for the given network
     */
    public isHomeChain(chainId: string, network: Network): boolean {
        const homeChains = {
            [Network.MAINNET]: ['bbn-1', 'Babylon Genesis'],
            [Network.TESTNET]: ['bbn-test-5', 'Babylon Genesis Testnet']
        };

        return homeChains[network]?.includes(chainId) || false;
    }

    /**
     * Get the home chain ID for the given network
     */
    public getHomeChainId(network: Network): string {
        return network === Network.MAINNET ? 'bbn-1' : 'bbn-test-5';
    }

    /**
     * Get the home chain name for the given network
     */
    public getHomeChainName(network: Network): string {
        return network === Network.MAINNET ? 'Babylon Genesis' : 'Babylon Testnet';
    }

    /**
     * Get external (non-home) chains from a list of chain IDs
     */
    public filterExternalChains(chainIds: string[], network: Network): string[] {
        const homeChainId = this.getHomeChainId(network);
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
        const homeChainId = this.getHomeChainId(network);
        
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
        return [Network.MAINNET, Network.TESTNET];
    }

    /**
     * Reset singleton instance (useful for testing)
     */
    public static resetInstance(): void {
        ChainConfigService.instance = null;
    }
} 