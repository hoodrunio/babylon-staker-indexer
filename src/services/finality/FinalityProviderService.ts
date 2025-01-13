import { Network } from '../../api/middleware/network-selector';
import { BabylonClient } from '../../clients/BabylonClient';
import { 
    FinalityProvider, 
    FinalityProviderPower,
    QueryFinalityProvidersResponse,
    QueryFinalityProviderResponse,
    QueryFinalityProviderDelegationsResponse,
    BTCDelegation
} from '../../types/finality/btcstaking';

export class FinalityProviderService {
    private static instance: FinalityProviderService | null = null;
    private babylonClient: BabylonClient;

    private constructor() {
        if (!process.env.BABYLON_NODE_URL || !process.env.BABYLON_RPC_URL) {
            throw new Error('BABYLON_NODE_URL and BABYLON_RPC_URL environment variables must be set');
        }
        this.babylonClient = BabylonClient.getInstance(
            process.env.BABYLON_NODE_URL,
            process.env.BABYLON_RPC_URL
        );
    }

    public static getInstance(): FinalityProviderService {
        if (!FinalityProviderService.instance) {
            FinalityProviderService.instance = new FinalityProviderService();
        }
        return FinalityProviderService.instance;
    }

    private getNetworkConfig(network: Network = Network.MAINNET) {
        return {
            nodeUrl: network === Network.MAINNET ? process.env.BABYLON_NODE_URL : process.env.BABYLON_TESTNET_NODE_URL,
            rpcUrl: network === Network.MAINNET ? process.env.BABYLON_RPC_URL : process.env.BABYLON_TESTNET_RPC_URL
        };
    }

    public async getActiveFinalityProviders(network: Network = Network.MAINNET): Promise<FinalityProvider[]> {
        const { nodeUrl } = this.getNetworkConfig(network);
        try {
            const response = await fetch(`${nodeUrl}/babylon/btcstaking/v1/finality_providers`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json() as QueryFinalityProvidersResponse;
            
            const activeProviders = data.finality_providers?.filter(provider => {
                if (provider.highest_voted_height === 0) {
                    return false;
                }
                
                if (provider.jailed) {
                    return false;
                }

                return true;
            }) || [];

            return activeProviders;
        } catch (error) {
            console.error('Error fetching active finality providers:', error);
            throw error;
        }
    }

    public async getAllFinalityProviders(network: Network = Network.MAINNET): Promise<FinalityProvider[]> {
        const { nodeUrl } = this.getNetworkConfig(network);
        try {
            const response = await fetch(`${nodeUrl}/babylon/btcstaking/v1/finality_providers`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json() as QueryFinalityProvidersResponse;
            return data.finality_providers || [];
        } catch (error) {
            console.error('Error fetching all finality providers:', error);
            throw error;
        }
    }

    public isProviderActive(provider: FinalityProvider): boolean {
        return provider.highest_voted_height > 0 && !provider.jailed;
    }

    public async getFinalityProvider(fpBtcPkHex: string, network: Network = Network.MAINNET): Promise<FinalityProvider> {
        const { nodeUrl } = this.getNetworkConfig(network);
        try {
            const response = await fetch(`${nodeUrl}/babylon/btcstaking/v1/finality_providers/${fpBtcPkHex}/finality_provider`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json() as QueryFinalityProviderResponse;
            return data.finality_provider;
        } catch (error) {
            console.error('Error fetching finality provider:', error);
            throw error;
        }
    }

    public async getFinalityProviderDelegations(fpBtcPkHex: string, network: Network = Network.MAINNET): Promise<BTCDelegation[]> {
        const { nodeUrl } = this.getNetworkConfig(network);
        try {
            const response = await fetch(`${nodeUrl}/babylon/btcstaking/v1/finality_providers/${fpBtcPkHex}/delegations`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json() as QueryFinalityProviderDelegationsResponse;
            return data.delegations || [];
        } catch (error) {
            console.error('Error fetching finality provider delegations:', error);
            throw error;
        }
    }

    public async getFinalityProviderPower(fpBtcPkHex: string, network: Network = Network.MAINNET): Promise<FinalityProviderPower> {
        const { nodeUrl } = this.getNetworkConfig(network);
        try {
            const response = await fetch(`${nodeUrl}/babylon/finality/v1/finality_providers/${fpBtcPkHex}/power`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json() as { power: string; height: number };
            return {
                fpBtcPkHex,
                power: data.power || '0',
                height: data.height || 0
            };
        } catch (error) {
            console.error('Error fetching finality provider power:', error);
            throw error;
        }
    }
} 