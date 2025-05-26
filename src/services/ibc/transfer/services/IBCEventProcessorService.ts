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
     * Process transfer events from IBC transactions
     * @param event IBC event containing transfer data
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
            // Extract attributes from event
            const attributes = this.packetService.extractEventAttributes(event);
            
            // Special handling for fungible_token_packet events
            if (event.type === 'fungible_token_packet') {
                // fungible_token_packet events only provide supplementary data
                // They should not create new transfers, only enrich existing ones
                await this.processTokenSupplementaryData(attributes, txHash, height, timestamp, network);
                return;
            }
            
            // For regular transfer events, extract packet info
            const packetInfo = this.packetService.handlePacketEvent(event.type, attributes, txHash);
            if (!packetInfo) {
                logger.warn(`[IBCEventProcessorService] Could not extract packet info for event type: ${event.type}`);
                return;
            }
            
            // Create a packet ID using the port, channel and sequence information
            const packetId = new mongoose.Types.ObjectId(packetInfo.packetId);
            const packetKey = `${packetInfo.sourcePort}/${packetInfo.sourceChannel}/${packetInfo.sequence}`;
            logger.debug(`[IBCEventProcessorService] Processing packet: ${packetKey}`);
            
            // For transfer events, we need to extract data from the packet data
            // Different event types may have packet data in different attributes
            let packetData = attributes.packet_data || attributes.data;
            let transferData: any = {};
            
            // Handle the cases where packet data might be missing
            if (!packetData) {
                if (event.type === 'acknowledge_packet') {
                    // For acknowledgments, we can continue without packet data
                    logger.debug(`[IBCEventProcessorService] Acknowledgment event without packet data`);
                } else {
                    // For non-ack events, we need packet data
                    logger.warn(`[IBCEventProcessorService] Missing packet_data for event type: ${event.type}`);
                    return;
                }
            }
            
            // Parse transfer data if available
            if (packetData) {
                try {
                    transferData = this.tokenService.parseTransferData(packetData);
                    logger.debug(`[IBCEventProcessorService] Parsed transfer data: ${JSON.stringify(transferData).substring(0, 200)}...`);
                } catch (error) {
                    logger.error(`[IBCEventProcessorService] Error parsing packet data: ${error instanceof Error ? error.message : String(error)}`);
                    // For send/recv events, transfer data is required
                    if (event.type === 'send_packet' || event.type === 'recv_packet') {
                        return;
                    }
                }
            }
            
            // Extract source and destination channel/port information for chain resolution
            const srcChannel = packetInfo.sourceChannel;
            const srcPort = packetInfo.sourcePort;
            const destChannel = packetInfo.destChannel;
            const destPort = packetInfo.destPort;
            

            
            // Resolve chain information using our improved chain resolver service
            // Initialize chain information variables
            let sourceChainId = '';
            let destChainId = '';
            let sourceChainName = '';
            let destChainName = '';
            
            try {
                // Get comprehensive chain information for both source and destination
                // Pass the event type to help determine transfer direction
                const chainInfo = await this.chainResolverService.getTransferChainInfo(
                    event.type,
                    srcChannel, 
                    srcPort, 
                    destChannel, 
                    destPort, 
                    network
                );
                
                // Use chain information from the resolver
                if (chainInfo) {
                    // Use resolved source chain information
                    if (chainInfo.source && chainInfo.source.chain_id) {
                        sourceChainId = chainInfo.source.chain_id;
                        sourceChainName = chainInfo.source.chain_name;
                        logger.debug(`[IBCEventProcessorService] Resolved source chain: ${sourceChainId} (${sourceChainName})`);
                    }
                    
                    // Use resolved destination chain information
                    if (chainInfo.destination && chainInfo.destination.chain_id) {
                        destChainId = chainInfo.destination.chain_id;
                        destChainName = chainInfo.destination.chain_name;
                        logger.debug(`[IBCEventProcessorService] Resolved destination chain: ${destChainId} (${destChainName})`);
                    }
                }
            } catch (error) {
                logger.warn(`[IBCEventProcessorService] Error resolving chain information: ${error instanceof Error ? error.message : String(error)}`);
            }
            
            // Handle different transfer event types
            switch (event.type) {
                case 'send_packet':
                case 'recv_packet': {
                    
                    // Format token information for display
                    const tokenSymbol = this.tokenService.extractTokenSymbol(transferData.denom || '');
                    const displayAmount = this.tokenService.formatTokenAmount(transferData.amount || '0', tokenSymbol);
                    
                    // Determine the transaction direction and status based on event type
                    const isRecvPacket = event.type === 'recv_packet';
                    const status = isRecvPacket ? IBCTransferStatus.RECEIVED : IBCTransferStatus.PENDING;
                    
                    // Create the transfer data object
                    const transfer: IBCTransferData = {
                        // Transfer details
                        sender: transferData.sender || '',
                        receiver: transferData.receiver || '',
                        denom: transferData.denom || '',
                        amount: transferData.amount || '0',
                        
                        // Transaction metadata
                        tx_hash: txHash,
                        
                        // Timing information
                        send_time: timestamp,
                        
                        // Status tracking
                        status: status,
                        success: isRecvPacket, // If it's a receive event, it's successful by default
                        
                        // Display information
                        token_symbol: tokenSymbol,
                        token_display_amount: displayAmount,
                        
                        // Chain information - now guaranteed to be set
                        source_chain_id: sourceChainId,
                        destination_chain_id: destChainId,
                        
                        // Human-readable chain names
                        source_chain_name: sourceChainName,
                        destination_chain_name: destChainName,
                        
                        // Channel information for filtering
                        source_channel: srcChannel,
                        destination_channel: destChannel,
                        
                        // Network
                        network: network.toString()
                    };
                    
                    try {
                        logger.debug(`[IBCEventProcessorService] Saving transfer with packet_id=${packetId} for packet ${packetKey}`);
                        
                        // Ensure we have required chain IDs
                        if (!sourceChainId) {
                            logger.warn(`[IBCEventProcessorService] Missing source_chain_id for transfer, using fallback`); 
                            transfer.source_chain_id = isRecvPacket ? 'external-chain' : (network === Network.MAINNET ? 'bbn-1' : 'bbn-test-5');
                            transfer.source_chain_name = isRecvPacket ? 'External Chain' : (network === Network.MAINNET ? 'Babylon Genesis' : 'Babylon Testnet');
                        }
                        
                        if (!destChainId) {
                            logger.warn(`[IBCEventProcessorService] Missing destination_chain_id for transfer, using fallback`);
                            transfer.destination_chain_id = isRecvPacket ? (network === Network.MAINNET ? 'bbn-1' : 'bbn-test-5') : 'external-chain';
                            transfer.destination_chain_name = isRecvPacket ? (network === Network.MAINNET ? 'Babylon Genesis' : 'Babylon Testnet') : 'External Chain';
                        }
                        
                        const savedTransfer = await this.transferRepository.saveTransfer(transfer, packetId, network);
                        
                        if (savedTransfer) {
                            logger.info(`[IBCEventProcessorService] Token transfer saved: ${transfer.amount} ${transfer.denom} from ${transfer.sender} to ${transfer.receiver} at height ${height}`);
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
            logger.debug(`[IBCEventProcessorService] Acknowledgment attributes: ${JSON.stringify(attributes)}`);
            
            // Extract packet information with transaction context awareness
            const packetInfo = this.packetService.handlePacketEvent(event.type, attributes, txHash);
            if (!packetInfo) {
                logger.warn(`[IBCEventProcessorService] Missing required packet attributes for acknowledgment event`);
                return;
            }
            
            // Create packet ID for looking up transfer
            const packetId = new mongoose.Types.ObjectId(packetInfo.packetId);
            
            // Check if the acknowledgment contains an error
            const isSuccessful = this.transferStatusService.isSuccessfulAcknowledgement(attributes);
            logger.debug(`[IBCEventProcessorService] Acknowledgment isSuccessful: ${isSuccessful}`);
            
            // Find the associated transfer
            const transferDoc = await this.transferRepository.getTransferByPacketId(packetId, network);
            
            if (!transferDoc) {
                logger.debug(`[IBCEventProcessorService] No transfer found for packet ${packetInfo.sourcePort}/${packetInfo.sourceChannel}/${packetInfo.sequence}`);
                return;
            }
            
            // Convert MongoDB document to plain object
            const transfer = transferDoc.toObject ? transferDoc.toObject() : transferDoc;
            logger.debug(`[IBCEventProcessorService] Found existing transfer: ${JSON.stringify(transfer)}`);
            
            // Update the transfer with acknowledgment information
            const updatedTransfer = this.transferStatusService.updateTransferForAcknowledgement(
                transfer,
                txHash,
                height,
                timestamp,
                isSuccessful,
                attributes.packet_ack_error || attributes.error
            );
            
            logger.debug(`[IBCEventProcessorService] Updated transfer data: ${JSON.stringify(updatedTransfer)}`);
            
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
            const transferDoc = await this.transferRepository.getTransferByPacketId(packetId, network);
            
            if (!transferDoc) {
                logger.debug(`[IBCEventProcessorService] No transfer found for packet ${packetInfo.sourcePort}/${packetInfo.sourceChannel}/${packetInfo.sequence}`);
                return;
            }
            
            // Convert MongoDB document to plain object
            const transfer = transferDoc.toObject ? transferDoc.toObject() : transferDoc;
            
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
    
    /**
     * Process fungible_token_packet events as supplementary data to enrich existing transfers
     * These events don't contain routing info but have detailed token transfer data
     * @param attributes Event attributes from fungible_token_packet
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    private async processTokenSupplementaryData(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCEventProcessorService] Processing fungible_token_packet supplementary data in tx ${txHash}`);
            
            // First, try to find a transfer associated with the current transaction
            // This handles cases where fungible_token_packet comes in the same transaction as send_packet or recv_packet
            let transferDoc = await this.transferRepository.getTransferByTxHash(txHash, network);
            
            if (transferDoc) {
                // Found transfer in the same transaction - this is likely a send/recv transaction
                // Convert MongoDB document to plain object
                const transfer = transferDoc.toObject ? transferDoc.toObject() : transferDoc;
                
                // Update with token details from fungible_token_packet
                const packetId = transfer.packet_id;
                
                // Extract token information from the fungible_token_packet event
                const denom = attributes.denom || transfer.denom;
                const amount = attributes.amount || transfer.amount;
                const sender = attributes.sender || transfer.sender;
                const receiver = attributes.receiver || transfer.receiver;
                const success = attributes.success === 'true' || attributes.success === '\u0001';
                const acknowledgement = attributes.acknowledgement;
                
                // Update the transfer with the supplementary data
                const updatedTransfer = {
                    ...transfer,
                    denom,
                    amount,
                    sender,
                    receiver,
                    // Update status based on the success flag and acknowledgement
                    success: success,
                    status: success ? IBCTransferStatus.COMPLETED : transfer.status,
                    // Add acknowledgement info if available
                    ...(acknowledgement && { acknowledgement }),
                    // Add any other relevant fields from the token packet
                    memo: attributes.memo || transfer.memo,
                    last_updated: timestamp
                };
                
                // Save the updated transfer
                await this.transferRepository.saveTransfer(updatedTransfer, packetId, network);
                
                logger.info(`[IBCEventProcessorService] Updated transfer with fungible_token_packet data: ${amount} ${denom} from ${sender} to ${receiver}, success: ${success}`);
                return;
            }
            
            // If no transfer found in current transaction, this might be an acknowledgment transaction
            // In acknowledgment transactions, fungible_token_packet events contain acknowledgment metadata
            // not transfer creation data. The actual transfer should already exist and be updated via acknowledge_packet event
            logger.debug(`[IBCEventProcessorService] No transfer found for current tx ${txHash}. This appears to be an acknowledgment transaction.`);
            logger.debug(`[IBCEventProcessorService] Acknowledgment transactions should update transfers via acknowledge_packet events, not fungible_token_packet events.`);
            logger.debug(`[IBCEventProcessorService] Skipping fungible_token_packet processing for acknowledgment transaction.`);
            
        } catch (error) {
            logger.error(`[IBCEventProcessorService] Error processing fungible_token_packet supplementary data: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
