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
import { formatSatoshis } from '../../utils/util';

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

    private calculatePowerPercentage(power: string, totalPower: string): string {
        if (!totalPower || totalPower === '0') return '0';
        
        const powerBigInt = BigInt(power);
        const totalPowerBigInt = BigInt(totalPower);
        
        // Hassasiyet için 10000 ile çarpıp sonra 100'e böleceğiz
        // (power / totalPower) * 100 = ((power * 10000) / totalPower) / 100
        const scaledPercentage = (powerBigInt * BigInt(10000)) / totalPowerBigInt;
        const actualPercentage = Number(scaledPercentage) / 100;        
        return actualPercentage.toFixed(2);
    }

    public async getFinalityProviderPower(fpBtcPkHex: string, network: Network = Network.MAINNET): Promise<FinalityProviderPower> {
        const { nodeUrl } = this.getNetworkConfig(network);
        try {
            // Provider'ın power'ını ve toplam power'ı paralel olarak al
            const [powerResponse, totalPower] = await Promise.all([
                fetch(`${nodeUrl}/babylon/finality/v1/finality_providers/${fpBtcPkHex}/power`),
                this.getTotalVotingPower(network)
            ]);

            if (!powerResponse.ok) {
                throw new Error(`HTTP error! status: ${powerResponse.status}`);
            }

            const data = await powerResponse.json() as { voting_power: string; height: number };
            const rawPower = data.voting_power || '0';
            
            const result = {
                fpBtcPkHex,
                power: formatSatoshis(Number(rawPower)),
                // rawPower,
                powerPercentage: this.calculatePowerPercentage(rawPower, totalPower.rawTotalPower),
                height: data.height || 0,
                totalPower: totalPower.totalPower,
                // rawTotalPower: totalPower.rawTotalPower
            };            
            return result;
        } catch (error) {
            console.error('Error fetching finality provider power:', error);
            throw error;
        }
    }

    private async getTotalVotingPower(network: Network = Network.MAINNET): Promise<{ totalPower: string; rawTotalPower: string }> {
        const { nodeUrl } = this.getNetworkConfig(network);
        try {
            // Önce current height'ı al
            const currentHeight = await this.babylonClient.getCurrentHeight();
            
            // ActiveFinalityProvidersAtHeight endpoint'ini kullan
            const response = await fetch(`${nodeUrl}/babylon/finality/v1/finality_providers/${currentHeight}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json() as { 
                finality_providers: Array<{ 
                    btc_pk: string; 
                    voting_power: string;
                    jailed: boolean;
                }> 
            };
            // Sadece jailed olmayan provider'ların power'larını topla
            const totalPowerBigInt = data.finality_providers
                .filter(fp => !fp.jailed)
                .reduce((acc, fp) => acc + BigInt(fp.voting_power || '0'), BigInt(0));
            
            const result = {
                totalPower: formatSatoshis(Number(totalPowerBigInt.toString())),
                rawTotalPower: totalPowerBigInt.toString()
            };
            return result;
        } catch (error) {
            console.error('Error calculating total voting power:', error);
            throw error;
        }
    }
} 