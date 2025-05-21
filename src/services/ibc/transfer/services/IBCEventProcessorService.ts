import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';
import { IIBCEventProcessorService, IIBCChainResolverService, IIBCPacketService, IIBCTokenService, IIBCTransferStatusService } from '../interfaces/IBCServices';
import { IIBCTransferRepository } from '../interfaces/IBCRepositories';
import { IBCEvent, IBCTransferData, IBCTransferStatus } from '../types/IBCTransferTypes';
import mongoose from 'mongoose';

/**
 * Service responsible for processing IBC transfer events
 * Follows Single Responsibility Principle by focusing only on event processing
 * and delegating specialized responsibilities to other services
 */
export class IBCEventProcessorService implements IIBCEventProcessorService {
    constructor(
        private readonly transferRepository: IIBCTransferRepository,
        private readonly chainResolverService: IIBCChainResolverService,
        private readonly packetService: IIBCPacketService,
        private readonly tokenService: IIBCTokenService,
        private readonly transferStatusService: IIBCTransferStatusService
    ) {}

    /**
     * Process a transfer-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processTransferEvent(
        event: IBCEvent, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCEventProcessorService] Processing transfer event: ${event.type} in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.packetService.extractEventAttributes(event);
            
            // For transfer events, we need to extract data from the packet data
            // Different event types may have packet data in different attributes
            let packetData = attributes.packet_data || attributes.data;
            
            // Handle the cases where packet data might be missing
            if (!packetData) {
                // Look for IBC ack packet success/errors
                if (event.type === 'acknowledge_packet' || event.type === 'write_acknowledgement') {
                    // For acks, we only need packet routing info which we already have
                    // So we can just continue processing even without packet data
                    logger.debug(`[IBCEventProcessorService] Processing acknowledgment without packet data`);
                } else if (event.type === 'fungible_token_packet') {
                    // fungible_token_packet events may have data in a different format
                    // Extract data from denom_trace attributes if available
                    const denom = attributes.denom;
                    const amount = attributes.amount;
                    const sender = attributes.sender;
                    const receiver = attributes.receiver;
                    
                    if (denom && amount && sender && receiver) {
                        // Construct packet data manually
                        packetData = JSON.stringify({ denom, amount, sender, receiver });
                        logger.debug(`[IBCEventProcessorService] Reconstructed packet data from fungible_token_packet attributes`);
                    } else {
                        logger.warn(`[IBCEventProcessorService] Missing packet_data and required attributes for transfer event`);
                        return;
                    }
                } else {
                    logger.warn(`[IBCEventProcessorService] Missing packet_data for transfer event type: ${event.type}`);
                    return;
                }
            }
            
            let transferData;
            try {
                // Try to parse packet data as JSON
                transferData = this.tokenService.parseTransferData(packetData);
                
                // Log parsed transfer data for debugging
                logger.debug(`[IBCEventProcessorService] Parsed transfer data: ${JSON.stringify(transferData).substring(0, 200)}...`);
            } catch (error) {
                logger.error(`[IBCEventProcessorService] Error parsing packet data: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
            
            // Extract packet information
            const packetInfo = this.packetService.extractPacketInfo(attributes);
            if (!packetInfo) {
                logger.warn(`[IBCEventProcessorService] Missing required packet attributes for transfer event`);
                return;
            }
            
            // Create a packet ID using the port, channel and sequence
            const packetId = new mongoose.Types.ObjectId(packetInfo.packetId);
            
            // Handle different transfer types
            switch (event.type) {
                case 'send_packet':
                case 'fungible_token_packet':
                case 'transfer_packet': {
                    // Extract channel and port information from attributes
                    const srcChannel = attributes.packet_src_channel || attributes.source_channel;
                    const srcPort = attributes.packet_src_port || attributes.source_port;
                    const destChannel = attributes.packet_dst_channel || attributes.destination_channel;
                    const destPort = attributes.packet_dst_port || attributes.destination_port;
                    
                    // Initialize chain information variables
                    let sourceChainId = '';
                    let destChainId = '';
                    
                    // Retrieve chain information from channel-connection-client relationships
                    if (srcChannel && srcPort && destChannel && destPort) {
                        try {
                            // Get comprehensive chain information for both source and destination
                            const chainInfo = await this.chainResolverService.getTransferChainInfo(
                                srcChannel, 
                                srcPort, 
                                destChannel, 
                                destPort, 
                                network
                            );
                            
                            // Use chain information from client-connection relationships
                            if (chainInfo) {
                                // Use resolved source chain information
                                if (chainInfo.source && chainInfo.source.chain_id) {
                                    sourceChainId = chainInfo.source.chain_id;
                                    logger.debug(`[IBCEventProcessorService] Resolved source chain: ${sourceChainId} (${chainInfo.source.chain_name})`);
                                }
                                
                                // Use resolved destination chain information
                                if (chainInfo.destination && chainInfo.destination.chain_id) {
                                    destChainId = chainInfo.destination.chain_id;
                                    logger.debug(`[IBCEventProcessorService] Resolved destination chain: ${destChainId} (${chainInfo.destination.chain_name})`);
                                }
                            }
                        } catch (error) {
                            logger.warn(`[IBCEventProcessorService] Error resolving chain information: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                    
                    // Format token information for display
                    const tokenSymbol = this.tokenService.extractTokenSymbol(transferData.denom);
                    const displayAmount = this.tokenService.formatTokenAmount(transferData.amount, tokenSymbol);
                    
                    // Create a unique packet key for tracing/debugging
                    const packetKey = `${packetInfo.sourcePort}/${packetInfo.sourceChannel}/${packetInfo.sequence}`;
                    
                    // Log the packet information for debugging
                    logger.debug(`[IBCEventProcessorService] Processing transfer with packet key: ${packetKey} and packetId: ${packetId}`);

                    // Create the transfer data object
                    const transfer: IBCTransferData = {
                        // Transfer details
                        sender: transferData.sender,
                        receiver: transferData.receiver,
                        denom: transferData.denom,
                        amount: transferData.amount,
                        
                        // Transaction metadata
                        tx_hash: txHash,
                        
                        // Timing information
                        send_time: timestamp,
                        
                        // Status tracking
                        status: IBCTransferStatus.PENDING,
                        success: false,
                        
                        // Display information
                        token_symbol: tokenSymbol,
                        token_display_amount: displayAmount,
                        
                        // Chain information
                        source_chain_id: sourceChainId,
                        destination_chain_id: destChainId,
                        
                        // Human-readable chain names
                        source_chain_name: sourceChainId || '',
                        destination_chain_name: destChainId || '',
                        
                        // Network
                        network: network.toString()
                    };
                    
                    try {
                        logger.debug(`[IBCEventProcessorService] Saving transfer with packet_id=${packetId} for packet ${packetKey}`);
                        const savedTransfer = await this.transferRepository.saveTransfer(transfer, packetId, network);
                        
                        if (savedTransfer) {
                            logger.info(`[IBCEventProcessorService] Token transfer saved: ${transferData.amount} ${transferData.denom} from ${transferData.sender} to ${transferData.receiver} at height ${height}`);
                        } else {
                            logger.error(`[IBCEventProcessorService] Failed to save transfer for packet ${packetKey}`);
                        }
                    } catch (err) {
                        logger.error(`[IBCEventProcessorService] Error saving transfer: ${err instanceof Error ? err.message : String(err)}`);
                    }
                    break;
                }
                    
                case 'acknowledge_packet': {
                    await this.processAcknowledgmentEvent(event, txHash, height, timestamp, network);
                    break;
                }
                    
                case 'timeout_packet': {
                    await this.processTimeoutEvent(event, txHash, height, timestamp, network);
                    break;
                }
                    
                default:
                    logger.debug(`[IBCEventProcessorService] Unhandled transfer event type: ${event.type}`);
            }
        } catch (error) {
            logger.error(`[IBCEventProcessorService] Error processing transfer event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Process an acknowledgment event to update an existing transfer
     * @param event Acknowledgment event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processAcknowledgmentEvent(
        event: IBCEvent, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCEventProcessorService] Processing acknowledgment event in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.packetService.extractEventAttributes(event);
            
            // Extract packet information
            const packetInfo = this.packetService.extractPacketInfo(attributes);
            if (!packetInfo) {
                logger.warn(`[IBCEventProcessorService] Missing required packet attributes for acknowledgment event`);
                return;
            }
            
            // Create packet ID for looking up transfer
            const packetId = new mongoose.Types.ObjectId(packetInfo.packetId);
            
            // Check if the acknowledgment contains an error
            const isSuccessful = this.transferStatusService.isSuccessfulAcknowledgement(attributes);
            
            // Find the associated transfer
            const transfer = await this.transferRepository.getTransferByPacketId(packetId, network);
            
            if (!transfer) {
                logger.debug(`[IBCEventProcessorService] No transfer found for packet ${packetInfo.sourcePort}/${packetInfo.sourceChannel}/${packetInfo.sequence}`);
                return;
            }
            
            // Update the transfer with acknowledgment information
            const updatedTransfer = this.transferStatusService.updateTransferForAcknowledgement(
                transfer,
                txHash,
                height,
                timestamp,
                isSuccessful,
                attributes.packet_ack_error || attributes.error
            );
            
            await this.transferRepository.saveTransfer(updatedTransfer, packetId, network);
            
            logger.info(`[IBCEventProcessorService] Transfer ${isSuccessful ? 'completed' : 'failed'}: ${packetInfo.sourcePort}/${packetInfo.sourceChannel}/${packetInfo.sequence} from ${transfer.sender} to ${transfer.receiver} (${transfer.amount} ${transfer.denom}) at height ${height}`);
        } catch (error) {
            logger.error(`[IBCEventProcessorService] Error processing acknowledgment event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Process a timeout event to mark a transfer as failed
     * @param event Timeout event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processTimeoutEvent(
        event: IBCEvent, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCEventProcessorService] Processing timeout event in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.packetService.extractEventAttributes(event);
            
            // Extract packet information
            const packetInfo = this.packetService.extractPacketInfo(attributes);
            if (!packetInfo) {
                logger.warn(`[IBCEventProcessorService] Missing required packet attributes for timeout event`);
                return;
            }
            
            // Create packet ID for looking up transfer
            const packetId = new mongoose.Types.ObjectId(packetInfo.packetId);
            
            // Find the associated transfer
            const transfer = await this.transferRepository.getTransferByPacketId(packetId, network);
            
            if (!transfer) {
                logger.debug(`[IBCEventProcessorService] No transfer found for packet ${packetInfo.sourcePort}/${packetInfo.sourceChannel}/${packetInfo.sequence}`);
                return;
            }
            
            // Update the transfer with timeout information
            const updatedTransfer = this.transferStatusService.updateTransferForTimeout(
                transfer,
                txHash,
                height,
                timestamp
            );
            
            await this.transferRepository.saveTransfer(updatedTransfer, packetId, network);
            
            logger.info(`[IBCEventProcessorService] Transfer timed out: ${packetInfo.sourcePort}/${packetInfo.sourceChannel}/${packetInfo.sequence} from ${transfer.sender} to ${transfer.receiver} (${transfer.amount} ${transfer.denom}) at height ${height}`);
        } catch (error) {
            logger.error(`[IBCEventProcessorService] Error processing timeout event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
