import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import IBCPacket from '../../../database/models/ibc/IBCPacket';

/**
 * Repository for managing IBC packet data
 */
export class IBCPacketRepository {
    /**
     * Save or update a packet in the database
     */
    public async savePacket(packetData: any, network: Network): Promise<any> {
        try {
            logger.debug(`[IBCPacketRepository] Save packet data for network ${network}: ${JSON.stringify(packetData)}`);
            
            return await IBCPacket.findOneAndUpdate(
                { 
                    source_port: packetData.source_port,
                    source_channel: packetData.source_channel,
                    destination_port: packetData.destination_port,
                    destination_channel: packetData.destination_channel, 
                    sequence: packetData.sequence,
                    network: network.toString()
                },
                {
                    ...packetData,
                    network: network.toString()
                },
                { upsert: true, new: true }
            );
        } catch (error) {
            logger.error(`[IBCPacketRepository] Error saving packet: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get a packet by its identifying fields
     */
    public async getPacket(
        sourcePort: string, 
        sourceChannel: string, 
        sequence: number, 
        network: Network
    ): Promise<any> {
        try {
            logger.debug(`[IBCPacketRepository] Get packet for source_port=${sourcePort}, source_channel=${sourceChannel}, sequence=${sequence}`);
            return await IBCPacket.findOne({ 
                source_port: sourcePort,
                source_channel: sourceChannel,
                sequence: sequence,
                network: network.toString()
            });
        } catch (error) {
            logger.error(`[IBCPacketRepository] Error getting packet: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Update packet status when a packet gets acknowledged
     */
    public async acknowledgePacket(
        sourcePort: string,
        sourceChannel: string,
        sequence: number,
        ackData: any,
        network: Network
    ): Promise<any> {
        try {
            return await IBCPacket.findOneAndUpdate(
                {
                    source_port: sourcePort,
                    source_channel: sourceChannel,
                    sequence: sequence,
                    network: network.toString()
                },
                {
                    $set: {
                        status: 'ACKNOWLEDGED',
                        ack_tx_hash: ackData.tx_hash,
                        ack_time: ackData.timestamp,
                        completion_time_ms: ackData.timestamp - ackData.send_time,
                        relayer_address: ackData.relayer_address
                    }
                },
                { new: true }
            );
        } catch (error) {
            logger.error(`[IBCPacketRepository] Error acknowledging packet: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Update packet status when a packet is received
     */
    public async receivePacket(
        sourcePort: string,
        sourceChannel: string,
        sequence: number,
        receiveData: any,
        network: Network
    ): Promise<any> {
        try {
            return await IBCPacket.findOneAndUpdate(
                {
                    source_port: sourcePort,
                    source_channel: sourceChannel,
                    sequence: sequence,
                    network: network.toString()
                },
                {
                    $set: {
                        status: 'RECEIVED',
                        receive_tx_hash: receiveData.tx_hash,
                        receive_time: receiveData.timestamp,
                        relayer_address: receiveData.relayer_address
                    }
                },
                { new: true }
            );
        } catch (error) {
            logger.error(`[IBCPacketRepository] Error receiving packet: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Update packet status when a packet times out
     */
    public async timeoutPacket(
        sourcePort: string,
        sourceChannel: string,
        sequence: number,
        timeoutData: any,
        network: Network
    ): Promise<any> {
        try {
            return await IBCPacket.findOneAndUpdate(
                {
                    source_port: sourcePort,
                    source_channel: sourceChannel,
                    sequence: sequence,
                    network: network.toString()
                },
                {
                    $set: {
                        status: 'TIMEOUT',
                        timeout_tx_hash: timeoutData.tx_hash,
                        timeout_time: timeoutData.timestamp,
                        relayer_address: timeoutData.relayer_address
                    }
                },
                { new: true }
            );
        } catch (error) {
            logger.error(`[IBCPacketRepository] Error timing out packet: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get all packets for a specific channel
     */
    public async getPacketsByChannel(
        channelId: string,
        portId: string,
        network: Network
    ): Promise<any[]> {
        try {
            return await IBCPacket.find({
                $or: [
                    { source_channel: channelId, source_port: portId },
                    { destination_channel: channelId, destination_port: portId }
                ],
                network: network.toString()
            }).sort({ sequence: -1 });
        } catch (error) {
            logger.error(`[IBCPacketRepository] Error getting packets by channel: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Get packets relayed by a specific address
     */
    public async getPacketsByRelayer(relayerAddress: string, network: Network): Promise<any[]> {
        try {
            return await IBCPacket.find({
                relayer_address: relayerAddress,
                network: network.toString()
            }).sort({ send_time: -1 });
        } catch (error) {
            logger.error(`[IBCPacketRepository] Error getting packets by relayer: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
}
