import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';
import {
    IRelayerAnalyticsProvider,
    RelayerByChainResult,
    RelayerVolumeResult,
    RelayerTransactionCountResult
} from '../../interfaces/IBCAnalyticsService';
import { IBCRelayerRepository } from '../../repository/IBCRelayerRepository';
import { ChainConfigService } from '../config/ChainConfigService';
import { getChainName } from '../../constants/chainMapping';
import IBCRelayerModel from '../../../../database/models/ibc/IBCRelayer';
import { RelayerVolumeService } from '../../relayer/RelayerVolumeService';

/**
 * Relayer Analytics Provider - follows SRP by handling only relayer-related analytics
 * Now uses SOLID-compliant TokenService for price and denomination handling
 */
export class RelayerAnalyticsProvider implements IRelayerAnalyticsProvider {
    private readonly chainConfig: ChainConfigService;
    private readonly volumeService: RelayerVolumeService;

    constructor(
        private readonly relayerRepository: IBCRelayerRepository
    ) {
        this.chainConfig = ChainConfigService.getInstance();
        this.volumeService = new RelayerVolumeService();
    }

    /**
     * Get relayers grouped by the chains they serve
     */
    async getRelayersByChain(network: Network): Promise<RelayerByChainResult[]> {
        try {
            logger.info(`[RelayerAnalyticsProvider] Getting relayers by chain for network: ${network}`);

            const relayers = await IBCRelayerModel.find({
                network: network.toString()
            });

            // Group relayers by chains they serve
            const chainRelayersMap = new Map<string, Set<string>>();

            relayers.forEach(relayer => {
                relayer.chains_served.forEach(chainId => {
                    // Skip home chain based on network configuration
                    if (this.chainConfig.isHomeChain(chainId, network)) return;
                    
                    if (!chainRelayersMap.has(chainId)) {
                        chainRelayersMap.set(chainId, new Set());
                    }
                    
                    chainRelayersMap.get(chainId)!.add(relayer.address);
                });
            });

            // Convert to result format
            const results: RelayerByChainResult[] = [];
            
            for (const [chainId, relayerAddresses] of chainRelayersMap.entries()) {
                results.push({
                    chain_id: chainId,
                    chain_name: getChainName(chainId),
                    relayer_addresses: Array.from(relayerAddresses),
                    active_relayer_count: relayerAddresses.size
                });
            }

            return results.sort((a, b) => b.active_relayer_count - a.active_relayer_count);
        } catch (error) {
            logger.error('[RelayerAnalyticsProvider] Error getting relayers by chain:', error);
            throw error;
        }
    }

    /**
     * Get volume statistics for each relayer - REFACTORED: Real-time USD calculation
     */
    async getRelayerVolumes(network: Network): Promise<RelayerVolumeResult[]> {
        try {
            logger.info(`[RelayerAnalyticsProvider] Getting relayer volumes for network: ${network}`);

            // Get all relayers with volume data (native amounts)
            const relayers = await IBCRelayerModel.find({
                network: network.toString(),
                volumes_by_denom: { $exists: true, $ne: {} } // Only relayers with volume
            });

            const results: RelayerVolumeResult[] = [];

            for (const relayer of relayers) {
                // Calculate total USD volume from native amounts (real-time)
                const totalVolumeUsd = await this.volumeService.calculateTotalUsdVolume(relayer.volumes_by_denom);
                
                // Skip relayers with zero USD volume
                if (totalVolumeUsd === 0) continue;

                // Convert chain volumes to USD (real-time)
                const volumes_by_chain: Record<string, string> = {};
                if (relayer.volumes_by_chain) {
                    const chainVolumesUsd = await this.volumeService.convertChainVolumesToUsd(relayer.volumes_by_chain);
                    for (const [chainId, usdVolume] of Object.entries(chainVolumesUsd)) {
                        volumes_by_chain[chainId] = usdVolume.toString();
                    }
                }

                // Calculate success rate
                const success_rate = relayer.total_packets_relayed > 0 ? 
                    (relayer.successful_packets / relayer.total_packets_relayed) * 100 : 0;

                results.push({
                    relayer_address: relayer.address,
                    total_volume_usd: totalVolumeUsd.toString(),
                    volumes_by_chain,
                    total_packets_relayed: relayer.total_packets_relayed,
                    success_rate: Math.round(success_rate * 100) / 100
                });
            }

            // Sort by USD volume (calculated real-time)
            results.sort((a, b) => parseFloat(b.total_volume_usd) - parseFloat(a.total_volume_usd));

            logger.info(`[RelayerAnalyticsProvider] Found ${results.length} relayers with volume data`);
            return results;
        } catch (error) {
            logger.error('[RelayerAnalyticsProvider] Error getting relayer volumes:', error);
            throw error;
        }
    }

    /**
     * Get transaction count statistics for each relayer - NOW USING DATABASE RELAYER DATA
     */
    async getRelayerTransactionCounts(network: Network): Promise<RelayerTransactionCountResult[]> {
        try {
            logger.info(`[RelayerAnalyticsProvider] Getting relayer transaction counts for network: ${network}`);

            // Get all relayers with transaction data directly from database
            const relayers = await IBCRelayerModel.find({
                network: network.toString(),
                total_packets_relayed: { $gt: 0 } // Only relayers with transactions
            }).sort({ total_packets_relayed: -1 }); // Sort by transaction count descending

            const results: RelayerTransactionCountResult[] = relayers.map(relayer => {
                // Calculate success rate
                const success_rate = relayer.total_packets_relayed > 0 ? 
                    (relayer.successful_packets / relayer.total_packets_relayed) * 100 : 0;

                return {
                    relayer_address: relayer.address,
                    total_transactions: relayer.total_packets_relayed,
                    successful_transactions: relayer.successful_packets,
                    failed_transactions: relayer.failed_packets,
                    success_rate: Math.round(success_rate * 100) / 100,
                    avg_completion_time_ms: Math.round(relayer.avg_relay_time_ms || 0)
                };
            });

            logger.info(`[RelayerAnalyticsProvider] Found ${results.length} relayers with transaction data`);
            return results;
        } catch (error) {
            logger.error('[RelayerAnalyticsProvider] Error getting relayer transaction counts:', error);
            throw error;
        }
    }
} 