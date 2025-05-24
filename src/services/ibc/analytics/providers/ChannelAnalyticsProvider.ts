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
import { IBCTransfer } from '../../../../database/models/ibc/IBCTransfer';
import IBCPacketModel from '../../../../database/models/ibc/IBCPacket';

/**
 * Channel Analytics Provider - follows SRP by handling only channel-related analytics
 * Implements DIP by depending on repository abstractions
 */
export class ChannelAnalyticsProvider implements IChannelAnalyticsProvider {
    constructor(
        private readonly channelRepository: IBCChannelRepository,
        private readonly transferRepository: IBCTransferRepository,
        private readonly packetRepository: IBCPacketRepository
    ) {}

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

            // Count active channels (OPEN state)
            const active_channels = channels_by_state['OPEN'] || 0;

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
     */
    async getChannelVolumes(network: Network): Promise<ChannelVolumeResult[]> {
        try {
            logger.info(`[ChannelAnalyticsProvider] Getting channel volumes for network: ${network}`);

            const channels = await this.channelRepository.getAllChannels(network);
            const channelVolumes: ChannelVolumeResult[] = [];

            for (const channel of channels) {
                // Get packets for this channel to find associated transfers
                const packets = await IBCPacketModel.find({
                    source_channel: channel.channel_id,
                    source_port: channel.port_id,
                    network: network.toString()
                });

                // Get transfers for these packets
                const packetIds = packets.map(p => p._id);
                const transfers = await this.getTransfersByPacketIds(packetIds, network);

                // Calculate volumes by denomination
                const volumes_by_denom: Record<string, string> = {};
                let total_volume_usd = '0';

                transfers.forEach((transfer: IBCTransfer) => {
                    if (transfer.success) {
                        const denom = transfer.denom;
                        const amount = transfer.amount;
                        
                        if (volumes_by_denom[denom]) {
                            volumes_by_denom[denom] = (
                                parseFloat(volumes_by_denom[denom]) + parseFloat(amount)
                            ).toString();
                        } else {
                            volumes_by_denom[denom] = amount;
                        }
                    }
                });

                // Calculate total USD value (simplified - would need price oracle in real implementation)
                total_volume_usd = this.calculateTotalVolumeUSD(volumes_by_denom);

                // Calculate success rate
                const successful_transfers = transfers.filter((t: IBCTransfer) => t.success).length;
                const success_rate = transfers.length > 0 ? 
                    (successful_transfers / transfers.length) * 100 : 0;

                channelVolumes.push({
                    channel_id: channel.channel_id,
                    port_id: channel.port_id,
                    counterparty_chain_id: channel.counterparty_chain_id,
                    counterparty_chain_name: channel.counterparty_chain_name || 'Unknown',
                    total_volume_usd,
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

    /**
     * Helper method to get transfers by packet IDs
     */
    private async getTransfersByPacketIds(packetIds: any[], network: Network): Promise<IBCTransfer[]> {
        try {
            // Use the existing model directly for complex queries
            const IBCTransferModel = (await import('../../../../database/models/ibc/IBCTransfer')).default;
            
            return await IBCTransferModel.find({
                packet_id: { $in: packetIds },
                network: network.toString()
            });
        } catch (error) {
            logger.error('[ChannelAnalyticsProvider] Error getting transfers by packet IDs:', error);
            return [];
        }
    }

    /**
     * Private helper method to calculate total USD volume
     * In a real implementation, this would integrate with a price oracle
     */
    private calculateTotalVolumeUSD(volumes_by_denom: Record<string, string>): string {
        // Simplified calculation - in reality would need price feeds
        const denomPrices: Record<string, number> = {
            'ubbn': 0.09, // 1 ubbn = 0.000001 BBN
            'uatom': 0.000001, // 1 uatom = 0.000001 ATOM
            'uosmo': 0.000001, // 1 uosmo = 0.000001 OSMO
            // Add more denominations as needed
        };

        let totalUSD = 0;
        
        Object.entries(volumes_by_denom).forEach(([denom, amount]) => {
            const price = denomPrices[denom] || 0;
            const tokenAmount = parseFloat(amount) * price;
            totalUSD += tokenAmount;
        });

        return totalUSD.toString();
    }
} 