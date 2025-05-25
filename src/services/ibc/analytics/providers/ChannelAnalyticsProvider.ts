import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';
import {
    IChannelAnalyticsProvider,
    ChannelStatsResult,
    ChannelVolumeResult
} from '../../interfaces/IBCAnalyticsService';
import { IBCChannelRepository } from '../../repository/IBCChannelRepository';
import { IBCTransferRepository } from '../../repository/IBCTransferRepository';
import { IBCPacketRepository } from '../../repository/IBCPacketRepository';
import { getTokenService } from '../domain/TokenServiceFactory';
import { ITokenService } from '../domain/TokenService';
import { IIBCChainResolverService } from '../../transfer/interfaces/IBCServices';

/**
 * Channel Analytics Provider - follows SRP by handling only channel-related analytics
 */
export class ChannelAnalyticsProvider implements IChannelAnalyticsProvider {
    private readonly tokenService: ITokenService;

    constructor(
        private readonly channelRepository: IBCChannelRepository,
        private readonly transferRepository: IBCTransferRepository,
        private readonly packetRepository: IBCPacketRepository,
        private readonly chainResolver: IIBCChainResolverService
    ) {
        this.tokenService = getTokenService();
    }

    /**
     * Get channel statistics including counts and state distribution
     */
    async getChannelStats(network: Network): Promise<ChannelStatsResult> {
        try {
            logger.info(`[ChannelAnalyticsProvider] Getting channel stats for network: ${network}`);

            const allChannels = await this.channelRepository.getAllChannels(network);
            
            // Calculate state distribution
            const channels_by_state = allChannels.reduce((acc, channel) => {
                const state = channel.state || 'UNKNOWN';
                acc[state] = (acc[state] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            // Count active channels (STATE_OPEN state)
            const active_channels = channels_by_state['STATE_OPEN'] || 0;

            return {
                total_channels: allChannels.length,
                active_channels,
                channels_by_state
            };
        } catch (error) {
            logger.error('[ChannelAnalyticsProvider] Error getting channel stats:', error);
            throw error;
        }
    }

    /**
     * Get channel volumes with detailed denomination breakdown
     * Now uses SOLID-compliant TokenService for volume calculations
     */
    async getChannelVolumes(network: Network): Promise<ChannelVolumeResult[]> {
        try {
            logger.info(`[ChannelAnalyticsProvider] Getting channel volumes for network: ${network}`);

            const channels = await this.channelRepository.getAllChannels(network);
            const channelVolumes: ChannelVolumeResult[] = [];

            for (const channel of channels) {
                // Use channel's total_tokens_transferred data directly from DB
                const volumes_by_denom: Record<string, string> = {};
                
                // Combine incoming and outgoing volumes from channel data
                if (channel.total_tokens_transferred) {
                    // Process incoming volumes (MongoDB Map to Object conversion)
                    if (channel.total_tokens_transferred.incoming) {
                        const incomingMap = channel.total_tokens_transferred.incoming instanceof Map 
                            ? channel.total_tokens_transferred.incoming 
                            : new Map(Object.entries(channel.total_tokens_transferred.incoming || {}));
                        
                        incomingMap.forEach((amount: number, denom: string) => {
                            const currentAmount = parseFloat(volumes_by_denom[denom] || '0');
                            volumes_by_denom[denom] = (currentAmount + amount).toString();
                        });
                    }
                    
                    // Process outgoing volumes (MongoDB Map to Object conversion)
                    if (channel.total_tokens_transferred.outgoing) {
                        const outgoingMap = channel.total_tokens_transferred.outgoing instanceof Map 
                            ? channel.total_tokens_transferred.outgoing 
                            : new Map(Object.entries(channel.total_tokens_transferred.outgoing || {}));
                        
                        outgoingMap.forEach((amount: number, denom: string) => {
                            const currentAmount = parseFloat(volumes_by_denom[denom] || '0');
                            volumes_by_denom[denom] = (currentAmount + amount).toString();
                        });
                    }
                }

                // Use TokenService for USD conversion - much cleaner!
                const denomAmounts = Object.entries(volumes_by_denom).map(([denom, amount]) => ({
                    denom,
                    amount: parseFloat(amount)
                }));

                const { total } = await this.tokenService.convertBatchToUsd(denomAmounts);

                // Calculate success rate from channel data
                const success_rate = channel.packet_count > 0 ? 
                    ((channel.success_count || 0) / channel.packet_count) * 100 : 0;

                // Use ChainResolver to get proper chain information
                let counterpartyChainName = 'Unknown';
                let counterpartyChainId = '';
                
                try {
                    const chainInfo = await this.chainResolver.getChainInfoFromChannel(
                        channel.channel_id, 
                        channel.port_id, 
                        network
                    );
                    
                    if (chainInfo) {
                        counterpartyChainName = chainInfo.chain_name;
                        counterpartyChainId = chainInfo.chain_id;
                    }
                } catch (error) {
                    logger.debug(`[ChannelAnalyticsProvider] Could not resolve chain for channel ${channel.channel_id}: ${error}`);
                    // Fallback to existing data
                    counterpartyChainName = channel.counterparty_chain_name || 'Unknown';
                    counterpartyChainId = channel.counterparty_chain_id || '';
                }

                channelVolumes.push({
                    channel_id: channel.channel_id,
                    port_id: channel.port_id,
                    counterparty_chain_id: counterpartyChainId,
                    counterparty_chain_name: counterpartyChainName,
                    total_volume_usd: total.toString(),
                    volumes_by_denom,
                    packet_count: channel.packet_count || 0,
                    success_rate: Math.round(success_rate * 100) / 100
                });
            }

            // Sort by total volume (descending)
            return channelVolumes.sort((a, b) => 
                parseFloat(b.total_volume_usd) - parseFloat(a.total_volume_usd)
            );
        } catch (error) {
            logger.error('[ChannelAnalyticsProvider] Error getting channel volumes:', error);
            throw error;
        }
    }

    /**
     * Get count of active (OPEN state) channels
     */
    async getActiveChannelsCount(network: Network): Promise<number> {
        try {
            logger.info(`[ChannelAnalyticsProvider] Getting active channels count for network: ${network}`);

            const openChannels = await this.channelRepository.getOpenChannels(network);
            return openChannels.length;
        } catch (error) {
            logger.error('[ChannelAnalyticsProvider] Error getting active channels count:', error);
            throw error;
        }
    }
} 