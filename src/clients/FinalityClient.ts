import { BaseClient } from './BaseClient';
import { logger } from '../utils/logger';
import { FinalityParams, FinalityProvider, Vote, CurrentEpochResponse } from '../types/finality';

/**
 * Finality verilerini almak için kullanılan istemci
 */
export class FinalityClient extends BaseClient {
    private currentEpochInfo: CurrentEpochResponse | null = null;

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
     * Mevcut epoch bilgilerini alır
     */
    async getCurrentEpoch(): Promise<CurrentEpochResponse> {
        return this.retryOperation(
            async () => {
                const response = await this.client.get('/babylon/epoching/v1/current_epoch');
                const data = response.data;
                logger.debug(`[Current Epoch Response] Current epoch: ${data.current_epoch}, Boundary: ${data.epoch_boundary}`);

                const current_epoch = Number(data.current_epoch);
                const epoch_boundary = Number(data.epoch_boundary);

                if (isNaN(current_epoch) || isNaN(epoch_boundary)) {
                    throw new Error('Invalid epoch data received from API');
                }

                this.currentEpochInfo = { current_epoch, epoch_boundary };
                return this.currentEpochInfo;
            },
            { current_epoch: 0, epoch_boundary: 0 },
            'getCurrentEpoch'
        );
    }

    /**
     * Finality parametrelerini alır
     */
    async getFinalityParams(): Promise<FinalityParams> {
        try {
            const response = await this.client.get('/babylon/finality/v1/params');
            return response.data.params;
        } catch (error) {
            logger.error('Error fetching finality params:', error);
            throw error;
        }
    }

    /**
     * Belirli bir yükseklikteki aktif finality sağlayıcıları alır
     * @param height Blok yüksekliği
     */
    async getActiveFinalityProvidersAtHeight(height: number): Promise<FinalityProvider[]> {
        try {
            const response = await this.client.get(`/babylon/finality/v1/finality_providers/${height}`);
            return response.data.finality_providers.map((provider: any) => ({
                fpBtcPkHex: provider.btc_pk_hex,
                height: parseInt(provider.height),
                votingPower: provider.voting_power,
                slashedBabylonHeight: provider.slashed_babylon_height,
                slashedBtcHeight: provider.slashed_btc_height,
                jailed: provider.jailed,
                highestVotedHeight: provider.highest_voted_height,
                description: provider.description
            }));
        } catch (error) {
            logger.error(`Error getting active finality providers at height ${height}:`, error);
            throw error;
        }
    }

    /**
     * Belirli bir yükseklikteki oyları alır
     * @param height Blok yüksekliği
     */
    async getVotesAtHeight(height: number): Promise<Vote[]> {
        return this.retryOperation(
            async () => {
                //logger.debug(`[Votes] Fetching votes for height ${height}`);
                const response = await this.client.get(`/babylon/finality/v1/votes/${height}`);
                
                if (!response.data) {
                    logger.warn(`[Votes] No data in response for height ${height}`);
                    return [];
                }

                if (!response.data.btc_pks) {
                    logger.warn(`[Votes] No btc_pks in response for height ${height}`);
                    return [];
                }

                if (!Array.isArray(response.data.btc_pks)) {
                    logger.warn(`[Votes] btc_pks is not an array for height ${height}`);
                    return [];
                }

                //logger.debug(`[Votes] Found ${response.data.btc_pks.length} votes for height ${height}`);
                
                // Duplicate check
                const uniquePks = new Set(response.data.btc_pks);
                if (uniquePks.size !== response.data.btc_pks.length) {
                    logger.warn(`[Votes] Found ${response.data.btc_pks.length - uniquePks.size} duplicate votes for height ${height}`);
                }

                const currentTime = new Date().toISOString();
                const votes = response.data.btc_pks.map((btcPk: string) => {
                    // Validate btcPk format
                    if (typeof btcPk !== 'string' || btcPk.length !== 64) {
                        logger.warn(`[Votes] Invalid btcPk format at height ${height}: ${btcPk}`);
                        return null;
                    }
                    return {
                        fp_btc_pk_hex: btcPk.toLowerCase(),
                        signature: '',
                        timestamp: currentTime
                    };
                }).filter((vote: Vote | null): vote is Vote => vote !== null);

                return votes;
            },
            [],
            `getVotesAtHeight(${height})`
        );
    }

    /**
     * Modül parametrelerini alır
     * @param module Modül adı
     */
    async getModuleParams(module: string): Promise<any> {
        try {
            const response = await this.client.get(`/babylon/${module}/v1/params`);
            return response.data.params;
        } catch (error) {
            logger.error(`Error fetching ${module} params:`, error);
            throw error;
        }
    }

    /**
     * Teşvik (incentive) parametrelerini alır
     */
    async getIncentiveParams(): Promise<any> {
        try {
            const response = await this.client.get('/babylon/incentive/params');
            return response.data.params;
        } catch (error) {
            logger.error('Error fetching incentive params:', error);
            throw error;
        }
    }
} 