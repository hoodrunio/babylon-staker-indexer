import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { getTokenService } from '../analytics/domain/TokenServiceFactory';
import { ITokenService } from '../analytics/domain/TokenService';

/**
 * RelayerVolumeService - REFACTORED to store only native amounts
 * USD calculations are done real-time for analytics to handle token volatility
 */
export class RelayerVolumeService {
    private readonly tokenService: ITokenService;

    constructor() {
        this.tokenService = getTokenService();
    }

    /**
     * Prepare volume update operations for MongoDB - REFACTORED: Only native amounts
     * @param transferData Transfer information including amount and denomination
     * @param sourceChainId Source chain ID
     * @param destChainId Destination chain ID
     * @param channelId Channel ID for channel-specific volume tracking
     * @param portId Port ID for channel-specific volume tracking
     * @returns MongoDB update operations for native amounts only
     */
    prepareVolumeUpdateOperations(
        transferData: {
            denom: string;
            amount: string;
        },
        sourceChainId: string,
        destChainId: string,
        channelId: string,
        portId: string
    ): {
        denomVolumeUpdate: any;
        chainVolumeUpdates: any[];
        channelVolumeUpdate: any;
    } {
        const amount = parseFloat(transferData.amount);
        const { denom } = transferData;

        // Total denomination volume update
        const denomVolumeUpdate = {
            $inc: {
                [`volumes_by_denom.${denom}`]: amount
            }
        };

        // Chain volume updates - separate updates for each chain
        const chainVolumeUpdates: any[] = [];
        const chainsInvolved = [sourceChainId, destChainId].filter(Boolean);
        
        chainsInvolved.forEach(chainId => {
            if (chainId) {
                chainVolumeUpdates.push({
                    $inc: {
                        [`volumes_by_chain.${chainId}.${denom}`]: amount
                    }
                });
            }
        });

        // Channel volume update - for existing channels
        const channelVolumeUpdate = {
            $inc: {
                [`active_channels.$.volumes_by_denom.${denom}`]: amount
            }
        };

        return {
            denomVolumeUpdate,
            chainVolumeUpdates,
            channelVolumeUpdate
        };
    }

    /**
     * Convert native token volumes to USD for analytics - REAL-TIME CALCULATION
     * @param volumesByDenom Map of denomination to native amount
     * @returns Total volume in USD and breakdown by denomination
     */
    async convertVolumesToUsd(
        volumesByDenom: Map<string, number> | Record<string, number>
    ): Promise<{
        total_usd: number;
        breakdown: Array<{ denom: string; amount: number; usd_value: number }>;
    }> {
        try {
            const breakdown: Array<{ denom: string; amount: number; usd_value: number }> = [];
            let totalUsd = 0;

            // Convert Map to Object if needed
            const volumesObj = volumesByDenom instanceof Map 
                ? Object.fromEntries(volumesByDenom) 
                : volumesByDenom;

            // Calculate USD values for each denomination
            for (const [denom, amount] of Object.entries(volumesObj)) {
                const usdValue = await this.tokenService.convertToUsd(denom, Number(amount));
                breakdown.push({
                    denom,
                    amount: Number(amount),
                    usd_value: usdValue
                });
                totalUsd += usdValue;
            }

            return {
                total_usd: totalUsd,
                breakdown
            };
        } catch (error) {
            logger.error('[RelayerVolumeService] Error converting volumes to USD:', error);
            return {
                total_usd: 0,
                breakdown: []
            };
        }
    }

    /**
     * Convert chain-specific volumes to USD for analytics - REAL-TIME CALCULATION
     * @param volumesByChain Map of chain_id to Map of denom to amount
     * @returns Chain volumes in USD
     */
    async convertChainVolumesToUsd(
        volumesByChain: Map<string, Map<string, number>> | Record<string, Record<string, number>>
    ): Promise<Record<string, number>> {
        try {
            const chainVolumesUsd: Record<string, number> = {};

            // Convert Map to Object if needed
            const chainsObj = volumesByChain instanceof Map 
                ? Object.fromEntries(
                    Array.from(volumesByChain.entries()).map(([chainId, denomMap]) => [
                        chainId, 
                        denomMap instanceof Map ? Object.fromEntries(denomMap) : denomMap
                    ])
                  )
                : volumesByChain;

            // Calculate USD value for each chain
            for (const [chainId, denomAmounts] of Object.entries(chainsObj)) {
                let chainTotalUsd = 0;
                
                for (const [denom, amount] of Object.entries(denomAmounts)) {
                    const usdValue = await this.tokenService.convertToUsd(denom, Number(amount));
                    chainTotalUsd += usdValue;
                }
                
                chainVolumesUsd[chainId] = chainTotalUsd;
            }

            return chainVolumesUsd;
        } catch (error) {
            logger.error('[RelayerVolumeService] Error converting chain volumes to USD:', error);
            return {};
        }
    }

    /**
     * Calculate total USD volume from native amounts - REAL-TIME CALCULATION
     * @param volumesByDenom Native token amounts by denomination
     * @returns Total USD value
     */
    async calculateTotalUsdVolume(
        volumesByDenom: Map<string, number> | Record<string, number>
    ): Promise<number> {
        try {
            const conversion = await this.convertVolumesToUsd(volumesByDenom);
            return conversion.total_usd;
        } catch (error) {
            logger.error('[RelayerVolumeService] Error calculating total USD volume:', error);
            return 0;
        }
    }
} 