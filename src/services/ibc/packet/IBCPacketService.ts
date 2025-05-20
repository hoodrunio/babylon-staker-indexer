import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCPacketRepository } from '../repository/IBCPacketRepository';

/**
 * Service responsible for processing and managing IBC packet data
 * Following Single Responsibility Principle - focuses only on packet operations
 */
export class IBCPacketService {
    private packetRepository: IBCPacketRepository;

    constructor() {
        this.packetRepository = new IBCPacketRepository();
    }

    /**
     * Process a packet-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processPacketEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCPacketService] Processing packet event: ${event.type} in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.extractEventAttributes(event);
            
            switch (event.type) {
                case 'send_packet':
                    await this.handleSendPacket(attributes, txHash, height, timestamp, network);
                    break;
                case 'recv_packet':
                    await this.handleRecvPacket(attributes, txHash, height, timestamp, network);
                    break;
                case 'acknowledge_packet':
                    await this.handleAcknowledgePacket(attributes, txHash, height, timestamp, network);
                    break;
                case 'timeout_packet':
                    await this.handleTimeoutPacket(attributes, txHash, height, timestamp, network);
                    break;
                case 'write_acknowledgement':
                    await this.handleWriteAcknowledgement(attributes, txHash, height, timestamp, network);
                    break;
                default:
                    logger.debug(`[IBCPacketService] Unhandled packet event type: ${event.type}`);
            }
        } catch (error) {
            logger.error(`[IBCPacketService] Error processing packet event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle send packet events
     */
    private async handleSendPacket(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const packetData = this.extractPacketDataFromAttributes(attributes);
            
            if (!packetData.sequence || !packetData.source_port || !packetData.source_channel) {
                logger.warn(`[IBCPacketService] Missing required attributes for send_packet`);
                return;
            }
            
            // Add send-specific data
            const fullPacketData = {
                ...packetData,
                status: 'SENT',
                send_tx_hash: txHash,
                send_height: height,
                send_timestamp: timestamp,
                network: network.toString(),
                last_updated: timestamp
            };
            
            await this.packetRepository.savePacket(fullPacketData, network);
            logger.info(`[IBCPacketService] Packet sent: ${packetData.source_port}/${packetData.source_channel}/${packetData.sequence} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCPacketService] Error handling send_packet: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle receive packet events
     */
    private async handleRecvPacket(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const packetData = this.extractPacketDataFromAttributes(attributes);
            
            if (!packetData.sequence || !packetData.source_port || !packetData.source_channel) {
                logger.warn(`[IBCPacketService] Missing required attributes for recv_packet`);
                return;
            }
            
            // Get existing packet data if available
            const existingPacket = await this.packetRepository.getPacket(
                packetData.source_port, 
                packetData.source_channel, 
                packetData.sequence, 
                network
            );
            
            // Add receive-specific data
            const fullPacketData = {
                ...(existingPacket || {}),
                ...packetData,
                status: 'RECEIVED',
                recv_tx_hash: txHash,
                recv_height: height,
                recv_timestamp: timestamp,
                network: network.toString(),
                last_updated: timestamp
            };
            
            await this.packetRepository.savePacket(fullPacketData, network);
            logger.info(`[IBCPacketService] Packet received: ${packetData.source_port}/${packetData.source_channel}/${packetData.sequence} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCPacketService] Error handling recv_packet: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle acknowledge packet events
     */
    private async handleAcknowledgePacket(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const packetData = this.extractPacketDataFromAttributes(attributes);
            
            if (!packetData.sequence || !packetData.source_port || !packetData.source_channel) {
                logger.warn(`[IBCPacketService] Missing required attributes for acknowledge_packet`);
                return;
            }
            
            // Get existing packet data if available
            const existingPacket = await this.packetRepository.getPacket(
                packetData.source_port, 
                packetData.source_channel, 
                packetData.sequence, 
                network
            );
            
            // Add ack-specific data
            const fullPacketData = {
                ...(existingPacket || {}),
                ...packetData,
                status: 'ACKNOWLEDGED',
                ack_tx_hash: txHash,
                ack_height: height,
                ack_timestamp: timestamp,
                network: network.toString(),
                last_updated: timestamp
            };
            
            await this.packetRepository.savePacket(fullPacketData, network);
            logger.info(`[IBCPacketService] Packet acknowledged: ${packetData.source_port}/${packetData.source_channel}/${packetData.sequence} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCPacketService] Error handling acknowledge_packet: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle timeout packet events
     */
    private async handleTimeoutPacket(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const packetData = this.extractPacketDataFromAttributes(attributes);
            
            if (!packetData.sequence || !packetData.source_port || !packetData.source_channel) {
                logger.warn(`[IBCPacketService] Missing required attributes for timeout_packet`);
                return;
            }
            
            // Get existing packet data if available
            const existingPacket = await this.packetRepository.getPacket(
                packetData.source_port, 
                packetData.source_channel, 
                packetData.sequence, 
                network
            );
            
            // Add timeout-specific data
            const fullPacketData = {
                ...(existingPacket || {}),
                ...packetData,
                status: 'TIMEOUT',
                timeout_tx_hash: txHash,
                timeout_height: height,
                timeout_timestamp: timestamp,
                network: network.toString(),
                last_updated: timestamp
            };
            
            await this.packetRepository.savePacket(fullPacketData, network);
            logger.info(`[IBCPacketService] Packet timed out: ${packetData.source_port}/${packetData.source_channel}/${packetData.sequence} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCPacketService] Error handling timeout_packet: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle write acknowledgement events
     */
    private async handleWriteAcknowledgement(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const packetData = this.extractPacketDataFromAttributes(attributes);
            
            if (!packetData.sequence || !packetData.source_port || !packetData.source_channel) {
                logger.warn(`[IBCPacketService] Missing required attributes for write_acknowledgement`);
                return;
            }
            
            // Get existing packet data if available
            const existingPacket = await this.packetRepository.getPacket(
                packetData.source_port, 
                packetData.source_channel, 
                packetData.sequence, 
                network
            );
            
            // Add write ack-specific data
            const fullPacketData = {
                ...(existingPacket || {}),
                ...packetData,
                status: 'ACK_WRITTEN',
                write_ack_tx_hash: txHash,
                write_ack_height: height,
                write_ack_timestamp: timestamp,
                network: network.toString(),
                last_updated: timestamp
            };
            
            await this.packetRepository.savePacket(fullPacketData, network);
            logger.info(`[IBCPacketService] Packet acknowledgement written: ${packetData.source_port}/${packetData.source_channel}/${packetData.sequence} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCPacketService] Error handling write_acknowledgement: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Extract packet data from event attributes
     */
    private extractPacketDataFromAttributes(attributes: Record<string, string>): any {
        const packetData: any = {};
        
        // Extract packet identification fields
        packetData.sequence = attributes.packet_sequence;
        packetData.source_port = attributes.packet_src_port;
        packetData.source_channel = attributes.packet_src_channel;
        packetData.destination_port = attributes.packet_dst_port;
        packetData.destination_channel = attributes.packet_dst_channel;
        
        // Extract other packet data fields if available
        if (attributes.packet_data) {
            try {
                packetData.data = JSON.parse(attributes.packet_data);
            } catch (e) {
                packetData.data = attributes.packet_data;
            }
        }
        
        if (attributes.packet_timeout_height) {
            packetData.timeout_height = attributes.packet_timeout_height;
        }
        
        if (attributes.packet_timeout_timestamp) {
            packetData.timeout_timestamp = attributes.packet_timeout_timestamp;
        }
        
        if (attributes.packet_ack) {
            try {
                packetData.acknowledgement = JSON.parse(attributes.packet_ack);
            } catch (e) {
                packetData.acknowledgement = attributes.packet_ack;
            }
        }
        
        return packetData;
    }

    /**
     * Extract attributes from an event into a key-value map
     */
    private extractEventAttributes(event: any): Record<string, string> {
        const attributes: Record<string, string> = {};
        
        if (!event.attributes || !Array.isArray(event.attributes)) {
            return attributes;
        }
        
        for (const attr of event.attributes) {
            if (attr.key && attr.value) {
                attributes[attr.key] = attr.value;
            }
        }
        
        return attributes;
    }
}
