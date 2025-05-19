import { Network } from '../../../types/finality';

/**
 * Interface for IBC Channel Service
 * Responsible for managing and querying IBC channels
 */
export interface IBCChannelService {
    /**
     * Process a channel-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network
     */
    processChannelEvent(event: any, txHash: string, height: number, timestamp: Date, network: Network): Promise<void>;

    /**
     * Get channel by ID
     * @param channelId Channel ID
     * @param portId Port ID
     * @param network Network
     */
    getChannel(channelId: string, portId: string, network: Network): Promise<any>;

    /**
     * Get all channels for a specific counterparty chain
     * @param counterpartyChainId Counterparty chain ID
     * @param network Network
     */
    getChannelsByCounterparty(counterpartyChainId: string, network: Network): Promise<any[]>;

    /**
     * Calculate and update channel metrics
     * @param channelId Channel ID
     * @param portId Port ID
     * @param network Network
     */
    updateChannelMetrics(channelId: string, portId: string, network: Network): Promise<void>;
}
