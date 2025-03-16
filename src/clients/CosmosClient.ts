import { BaseClient } from './BaseClient';
import { logger } from '../utils/logger';

/**
 * Client used to retrieve Cosmos SDK module parameters
 */
export class CosmosClient extends BaseClient {
    /**
     * @param network Network type
     * @param nodeUrl Node URL
     * @param rpcUrl RPC URL
     * @param wsUrl WebSocket URL (optional)
     */
    public constructor(
        network: any,
        nodeUrl: string,
        rpcUrl: string,
        wsUrl?: string
    ) {
        super(network, nodeUrl, rpcUrl, wsUrl);
    }

    /**
     * Gets the parameters for a Cosmos SDK module
     * @param module Module name (slashing, staking, distribution)
     */
    async getModuleParams(module: string): Promise<any> {
        try {
            // Cosmos SDK modülleri için endpoint formatı: /cosmos/{module}/v1beta1/params
            const response = await this.client.get(`/cosmos/${module}/v1beta1/params`);
            
            if (!response.data) {
                logger.warn(`[Cosmos] No parameters found for module ${module}`);
                return null;
            }
            
            return response.data;
        } catch (error) {
            logger.error(`[Cosmos] Error fetching ${module} params:`, error);
            throw error;
        }
    }

    /**
     * Gets the slashing parameters
     */
    async getSlashingParams(): Promise<any> {
        return this.getModuleParams('slashing');
    }

    /**
     * Gets the staking parameters
     */
    async getStakingParams(): Promise<any> {
        return this.getModuleParams('staking');
    }

    /**
     * Gets the minting parameters
     * Özel endpoint: /cosmos/mint/v1beta1/inflation_rate, annual_provisions, genesis_time
     */
    async getMintParams(): Promise<any> {
        try {
            // Mint modülü için tüm parametreleri al
            const [inflationRate, annualProvisions, genesisTime] = await Promise.all([
                this.client.get('/cosmos/mint/v1beta1/inflation_rate'),
                this.client.get('/cosmos/mint/v1beta1/annual_provisions'),
                this.client.get('/cosmos/mint/v1beta1/genesis_time')
            ]);
            
            // Tüm mint parametrelerini birleştir
            return {
                inflation_rate: inflationRate.data?.inflation || null,
                annual_provisions: annualProvisions.data?.annual_provisions || null,
                genesis_time: genesisTime.data?.genesis_time || null
            };
        } catch (error) {
            logger.error('[Cosmos] Error fetching mint params:', error);
            throw error;
        }
    }

    /**
     * Gets the governance parameters
     * Özel endpoint: /cosmos/gov/v1/params/{voting, tallying, deposit}
     */
    async getGovParams(): Promise<any> {
        try {
            const [votingParams, tallyingParams, depositParams] = await Promise.all([
                this.client.get('/cosmos/gov/v1/params/voting'),
                this.client.get('/cosmos/gov/v1/params/tallying'),
                this.client.get('/cosmos/gov/v1/params/deposit')
            ]);
            
            // Tüm governance parametrelerini birleştir
            return {
                voting: votingParams.data?.params || null,
                tallying: tallyingParams.data?.params || null,
                deposit: depositParams.data?.params || null
            };
        } catch (error) {
            logger.error('[Cosmos] Error fetching governance params:', error);
            throw error;
        }
    }

    /**
     * Gets the distribution parameters
     */
    async getDistributionParams(): Promise<any> {
        return this.getModuleParams('distribution');
    }
} 