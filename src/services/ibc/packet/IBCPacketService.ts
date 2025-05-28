import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCPacketRepository } from '../repository/IBCPacketRepository';
import { IBCEventUtils } from '../common/IBCEventUtils';
import { IIBCChainResolverService } from '../transfer/interfaces/IBCServices';
import { getChainName } from '../constants/chainMapping';

/**
 * Service responsible for processing and managing IBC packet data
 * Following Single Responsibility Principle - focuses only on packet operations
 */
export class IBCPacketService {
    private readonly serviceName = 'IBCPacketService';
    private packetRepository: IBCPacketRepository;
    private chainResolver: IIBCChainResolverService;

    constructor(
        packetRepository: IBCPacketRepository = new IBCPacketRepository(), 
        chainResolver: IIBCChainResolverService
    ) {
        this.packetRepository = packetRepository;
        this.chainResolver = chainResolver;
        
        if (!this.chainResolver) {
            throw new Error('[IBCPacketService] Chain resolver is required');
        }
    }

    /**
     * Process a packet-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     * @param relayerAddress Optional relayer address from transaction signer
     */
    public async processPacketEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network,
        relayerAddress?: string
    ): Promise<void> {
        try {
            IBCEventUtils.logEventStart(this.serviceName, event.type, txHash);
            
            // Extract attributes from event
            const attributes = IBCEventUtils.extractEventAttributes(event);
            
            switch (event.type) {
                case 'send_packet':
                    await this.handleSendPacket(attributes, txHash, height, timestamp, network);
                    break;
                case 'recv_packet':
                    await this.handleRecvPacket(attributes, txHash, height, timestamp, network, relayerAddress);
                    break;
                case 'acknowledge_packet':
                    await this.handleAcknowledgePacket(attributes, txHash, height, timestamp, network, relayerAddress);
                    break;
                case 'timeout_packet':
                    await this.handleTimeoutPacket(attributes, txHash, height, timestamp, network, relayerAddress);
                    break;
                default:
                    // Do not log unhandled events as warnings - they may be processed by other services
                    break;
            }
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, event.type, error);
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
        network: Network,
    ): Promise<void> {
        try {
            const packetData = await this.extractPacketDataFromAttributes(attributes, network, 'send_packet');
            
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
                send_time: timestamp,
                network: network.toString(),
                last_updated: timestamp
            };
            
            await this.packetRepository.savePacket(fullPacketData, network);
            IBCEventUtils.logEventSuccess(this.serviceName, 'send_packet', `Packet sent: ${packetData.source_port}/${packetData.source_channel}/${packetData.sequence}`, height);
        } catch (error) {
            IBCEventUtils.logEventError(this.serviceName, 'send_packet', error);
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
        network: Network,
        relayerAddress?: string
    ): Promise<void> {
        try {
            const packetData = await this.extractPacketDataFromAttributes(attributes, network, 'recv_packet');
            
            if (!packetData.sequence || !packetData.source_port || !packetData.source_channel) {
                logger.warn(`[IBCPacketService] Missing required attributes for recv_packet`);
                return;
            }
            
            // Get existing packet data if available
            const existingPacketDoc = await this.packetRepository.getPacket(
                packetData.source_port, 
                packetData.source_channel, 
                packetData.sequence, 
                network
            );
            
            // Convert MongoDB document to plain object
            const existingPacket = existingPacketDoc?.toObject ? existingPacketDoc.toObject() : existingPacketDoc;
            
            // Add receive-specific data
            const fullPacketData = {
                ...(existingPacket || {}),
                ...packetData,
                status: 'RECEIVED',
                receive_tx_hash: txHash,
                recv_height: height,
                receive_time: timestamp,
                relayer_address: relayerAddress,
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
        network: Network,
        relayerAddress?: string
    ): Promise<void> {
        try {
            const packetData = await this.extractPacketDataFromAttributes(attributes, network, 'acknowledge_packet');
            
            if (!packetData.sequence || !packetData.source_port || !packetData.source_channel) {
                logger.warn(`[IBCPacketService] Missing required attributes for acknowledge_packet`);
                return;
            }
            
            // Get existing packet data if available
            const existingPacketDoc = await this.packetRepository.getPacket(
                packetData.source_port, 
                packetData.source_channel, 
                packetData.sequence, 
                network
            );
            
            // Convert MongoDB document to plain object
            const existingPacket = existingPacketDoc?.toObject ? existingPacketDoc.toObject() : existingPacketDoc;
            
            // Add ack-specific data
            const fullPacketData = {
                ...(existingPacket || {}),
                ...packetData,
                status: 'ACKNOWLEDGED',
                ack_tx_hash: txHash,
                ack_height: height,
                ack_time: timestamp,
                relayer_address: relayerAddress,
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
        network: Network,
        relayerAddress?: string
    ): Promise<void> {
        try {
            const packetData = await this.extractPacketDataFromAttributes(attributes, network, 'timeout_packet');
            
            if (!packetData.sequence || !packetData.source_port || !packetData.source_channel) {
                logger.warn(`[IBCPacketService] Missing required attributes for timeout_packet`);
                return;
            }
            
            // Get existing packet data if available
            const existingPacketDoc = await this.packetRepository.getPacket(
                packetData.source_port, 
                packetData.source_channel, 
                packetData.sequence, 
                network
            );
            
            // Convert MongoDB document to plain object
            const existingPacket = existingPacketDoc?.toObject ? existingPacketDoc.toObject() : existingPacketDoc;
            
            // Add timeout-specific data
            const fullPacketData = {
                ...(existingPacket || {}),
                ...packetData,
                status: 'TIMEOUT',
                timeout_tx_hash: txHash,
                timeout_height: height,
                timeout_time: timestamp,
                relayer_address: relayerAddress,
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
     * Extract packet data from event attributes
     */
    private async extractPacketDataFromAttributes(attributes: Record<string, string>, network: Network, eventType?: string): Promise<any> {
        const packetData: any = {};
        
        // Extract packet identification fields
        packetData.sequence = attributes.packet_sequence;
        packetData.source_port = attributes.packet_src_port;
        packetData.source_channel = attributes.packet_src_channel;
        packetData.destination_port = attributes.packet_dst_port;
        packetData.destination_channel = attributes.packet_dst_channel;
        
        const isMainnet = network === 'mainnet';
        const localChainId = isMainnet ? 'bbn-1' : 'bbn-test-5';
        const localChainName = getChainName(localChainId);
        
        // Determine packet direction based on event type
        const isOutbound = this.determinePacketDirection(eventType);
        
        // Resolve chain information using chain resolver
        const channelToResolve = isOutbound ? packetData.source_channel : packetData.destination_channel;
        const portToResolve = isOutbound ? packetData.source_port : packetData.destination_port;
        
        if (channelToResolve && portToResolve) {
            try {
                const chainInfo = await this.chainResolver.getChainInfoFromChannel(
                    channelToResolve,
                    portToResolve,
                    network
                );
                
                if (chainInfo) {
                    if (isOutbound) {
                        // Outbound: source=local, destination=remote
                        packetData.source_chain_id = localChainId;
                        packetData.source_chain_name = localChainName;
                        packetData.destination_chain_id = chainInfo.chain_id;
                        packetData.destination_chain_name = chainInfo.chain_name;
                    } else {
                        // Inbound: source=remote, destination=local
                        packetData.source_chain_id = chainInfo.chain_id;
                        packetData.source_chain_name = chainInfo.chain_name;
                        packetData.destination_chain_id = localChainId;
                        packetData.destination_chain_name = localChainName;
                    }
                } else {
                    logger.warn(`[IBCPacketService] Could not resolve chain info for channel ${channelToResolve} - using fallback`);
                    // Set local chain info and leave remote chain info undefined
                    if (isOutbound) {
                        packetData.source_chain_id = localChainId;
                        packetData.source_chain_name = localChainName;
                        // destination chain info will remain undefined
                    } else {
                        packetData.destination_chain_id = localChainId;
                        packetData.destination_chain_name = localChainName;
                        // source chain info will remain undefined
                    }
                }
            } catch (error) {
                logger.error(`[IBCPacketService] Error resolving chain info: ${error}`);
                // Set local chain info and leave remote chain info undefined
                if (isOutbound) {
                    packetData.source_chain_id = localChainId;
                    packetData.source_chain_name = localChainName;
                    // destination chain info will remain undefined
                } else {
                    packetData.destination_chain_id = localChainId;
                    packetData.destination_chain_name = localChainName;
                    // source chain info will remain undefined
                }
            }
        } else {
            logger.warn(`[IBCPacketService] Missing channel/port info for chain resolution`);
            // Set local chain info based on direction
            if (isOutbound) {
                packetData.source_chain_id = localChainId;
                packetData.source_chain_name = localChainName;
            } else {
                packetData.destination_chain_id = localChainId;
                packetData.destination_chain_name = localChainName;
            }
        }
        
        // Extract other packet data fields if available
        if (attributes.packet_data) {
            try {
                packetData.data_hex = attributes.packet_data;
                packetData.data = JSON.parse(attributes.packet_data);
            } catch (e) {
                packetData.data_hex = attributes.packet_data;
                packetData.data = attributes.packet_data;
            }
        }
        
        if (attributes.packet_timeout_height) {
            try {
                const [revisionNumber, revisionHeight] = attributes.packet_timeout_height.split('-');
                packetData.timeout_height = {
                    revision_number: parseInt(revisionNumber) || 0,
                    revision_height: parseInt(revisionHeight) || 0
                };
            } catch (e) {
                packetData.timeout_height = {
                    revision_number: 0,
                    revision_height: 0
                };
            }
        }
        
        if (attributes.packet_timeout_timestamp) {
            packetData.timeout_timestamp = parseInt(attributes.packet_timeout_timestamp) || 0;
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
     * Determine packet direction based on event type and channel information
     * @param eventType The event type (send_packet, recv_packet, etc.)
     * @param sourceChannel Source channel ID
     * @param destChannel Destination channel ID
     * @returns true if outbound (from Babylon to other chain), false if inbound
     */
    private determinePacketDirection(eventType?: string): boolean {
        // If no event type, default to outbound
        if (!eventType) {
            return true;
        }

        switch (eventType) {
            case 'send_packet':
            case 'acknowledge_packet':
            case 'timeout_packet':
                // Send / acknowledge / timeout packets are always outbound from our perspective
                return true;
            
            case 'recv_packet':
                // Receive packets are always inbound to our perspective
                return false;

            default:
                return true;
        }
    }
}
