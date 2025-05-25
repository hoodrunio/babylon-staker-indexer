import { Network } from '../../../types/finality';

/**
 * Interface for IBC Packet Service
 * Responsible for managing and querying IBC packets
 */
export interface IBCPacketService {
    /**
     * Process a packet-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network
     * @param relayerAddress Optional relayer address from transaction signer
     */
    processPacketEvent(event: any, txHash: string, height: number, timestamp: Date, network: Network, relayerAddress?: string): Promise<void>;

    /**
     * Get packet by sequence
     * @param channelId Channel ID
     * @param portId Port ID
     * @param sequence Packet sequence
     * @param network Network
     */
    getPacket(channelId: string, portId: string, sequence: number, network: Network): Promise<any>;

    /**
     * Get all packets for a channel
     * @param channelId Channel ID
     * @param portId Port ID
     * @param network Network
     * @param limit Optional limit
     * @param offset Optional offset
     */
    getPacketsByChannel(channelId: string, portId: string, network: Network, limit?: number, offset?: number): Promise<any[]>;

    /**
     * Calculate packet statistics for a channel
     * @param channelId Channel ID
     * @param portId Port ID
     * @param network Network
     */
    getPacketStats(channelId: string, portId: string, network: Network): Promise<any>;
}
