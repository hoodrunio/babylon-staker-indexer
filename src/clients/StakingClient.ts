import { BaseClient } from './BaseClient';
import { logger } from '../utils/logger';

/**
 * Staking verilerini almak için kullanılan istemci
 */
export class StakingClient extends BaseClient {
    /**
     * @param network Ağ tipi
     * @param nodeUrl Node URL
     * @param rpcUrl RPC URL
     * @param wsUrl WebSocket URL (opsiyonel)
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
     * Unbonding süresini alır
     * @param validatorAddress Validator adresi (opsiyonel)
     */
    public async getUnbondingPeriod(validatorAddress?: string): Promise<number> {
        try {
            logger.debug(`[StakingClient] Getting unbonding period for ${this.network}`);
            
            // Get staking parameters which include the unbonding time
            const response = await this.client.get('/cosmos/staking/v1beta1/params');
            
            if (!response || !response.data || !response.data.params) {
                throw new Error('Invalid response from Babylon node');
            }
            
            // Unbonding time is returned in nanoseconds, convert to seconds
            const unbondingTimeStr = response.data.params.unbonding_time;
            const unbondingTimeInSeconds = parseInt(unbondingTimeStr.replace('s', ''));
            
            return unbondingTimeInSeconds;
        } catch (error) {
            logger.error(`[StakingClient] Error getting unbonding period for ${this.network}:`, error);
            
            // Return default unbonding period (21 days in seconds) if we can't get it from the node
            return 21 * 24 * 60 * 60;
        }
    }
} 