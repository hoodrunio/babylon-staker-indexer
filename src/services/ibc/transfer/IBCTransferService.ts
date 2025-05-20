import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCTransferRepository } from '../repository/IBCTransferRepository';
import mongoose from 'mongoose';

/**
 * Service responsible for processing and managing IBC transfer data
 * Following Single Responsibility Principle - focuses only on token transfer operations
 */
export class IBCTransferService {
    private transferRepository: IBCTransferRepository;

    constructor() {
        this.transferRepository = new IBCTransferRepository();
    }

    /**
     * Process a transfer-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processTransferEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCTransferService] Processing transfer event: ${event.type} in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.extractEventAttributes(event);
            
            // For transfer events, we need to extract data from the packet data
            const packetData = attributes.packet_data;
            
            if (!packetData) {
                logger.warn(`[IBCTransferService] Missing packet_data for transfer event`);
                return;
            }
            
            let transferData;
            try {
                // Try to parse packet data as JSON
                transferData = typeof packetData === 'string' ? JSON.parse(packetData) : packetData;
            } catch (error) {
                logger.error(`[IBCTransferService] Error parsing packet data: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
            
            // Extract common fields from packet attributes
            const sourcePort = attributes.packet_src_port;
            const sourceChannel = attributes.packet_src_channel;
            const sequence = attributes.packet_sequence;
            const destPort = attributes.packet_dst_port;
            const destChannel = attributes.packet_dst_channel;
            
            if (!sourcePort || !sourceChannel || !sequence) {
                logger.warn(`[IBCTransferService] Missing required packet attributes for transfer event`);
                return;
            }
            
            // Create a packet ID using the port, channel and sequence
            // This will be used as a unique identifier for the packet across different events
            const packetId = this.createPacketId(sourcePort, sourceChannel, sequence);
            
            // Handle different transfer types
            switch (event.type) {
                case 'fungible_token_packet':
                case 'transfer_packet': {
                    // Extract client and connection information from channel if available
                    const sourceChainId = attributes.source_chain || attributes.chain_id;
                    const destChainId = attributes.destination_chain || attributes.counterparty_chain_id;
                    
                    // Format token information for display
                    const tokenSymbol = this.extractTokenSymbol(transferData.denom);
                    const displayAmount = this.formatTokenAmount(transferData.amount, tokenSymbol);
                    
                    // Basic transfer data fields
                    const transfer = {
                        source_port: sourcePort,
                        source_channel: sourceChannel,
                        dest_port: destPort,
                        dest_channel: destChannel,
                        sequence: sequence,
                        sender: transferData.sender,
                        receiver: transferData.receiver,
                        denom: transferData.denom,
                        amount: transferData.amount,
                        tx_hash: txHash,
                        height: height,
                        send_time: timestamp,
                        status: 'SENT',
                        success: false,
                        token_symbol: tokenSymbol,
                        token_display_amount: displayAmount,
                        source_chain_id: sourceChainId,
                        destination_chain_id: destChainId,
                        network: network.toString()
                    };
                    
                    await this.transferRepository.saveTransfer(transfer, packetId, network);
                    logger.info(`[IBCTransferService] Token transfer: ${transferData.amount} ${transferData.denom} from ${transferData.sender} to ${transferData.receiver} at height ${height}`);
                    break;
                }
                    
                case 'recv_packet': {
                    // Check if this is a completed transfer
                    const existingTransfer = await this.transferRepository.getTransferByPacketId(packetId, network);
                    
                    if (existingTransfer) {
                        // Update status for existing transfer
                        const updatedTransfer = {
                            ...existingTransfer,
                            status: 'COMPLETED',
                            completion_tx_hash: txHash,
                            completion_height: height,
                            completion_timestamp: timestamp
                        };
                        
                        await this.transferRepository.saveTransfer(updatedTransfer, packetId, network);
                        logger.info(`[IBCTransferService] Token transfer completed: ${sourcePort}/${sourceChannel}/${sequence} at height ${height}`);
                    }
                    break;
                }
                    
                case 'timeout_packet': {
                    // Check if this is a timed-out transfer
                    const timedOutTransfer = await this.transferRepository.getTransferByPacketId(packetId, network);
                    
                    if (timedOutTransfer) {
                        // Update status for timed-out transfer
                        const updatedTransfer = {
                            ...timedOutTransfer,
                            status: 'TIMEOUT',
                            timeout_tx_hash: txHash,
                            timeout_height: height,
                            timeout_timestamp: timestamp
                        };
                        
                        await this.transferRepository.saveTransfer(updatedTransfer, packetId, network);
                        logger.info(`[IBCTransferService] Token transfer timed out: ${sourcePort}/${sourceChannel}/${sequence} at height ${height}`);
                    }
                    break;
                }
                    
                default:
                    logger.debug(`[IBCTransferService] Unhandled transfer event type: ${event.type}`);
            }
        } catch (error) {
            logger.error(`[IBCTransferService] Error processing transfer event: ${error instanceof Error ? error.message : String(error)}`);
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
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCTransferService] Processing acknowledgment event in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.extractEventAttributes(event);
            
            // Get packet details to identify the transfer
            const sourcePort = attributes.packet_src_port;
            const sourceChannel = attributes.packet_src_channel;
            const sequence = attributes.packet_sequence;
            
            if (!sourcePort || !sourceChannel || !sequence) {
                logger.warn(`[IBCTransferService] Missing required packet attributes for acknowledgment event`);
                return;
            }
            
            // Create packet ID using the same method used for initial transfer
            const packetId = this.createPacketId(sourcePort, sourceChannel, sequence);
            
            // Find the associated transfer
            const transfer = await this.transferRepository.getTransferByPacketId(packetId, network);
            
            if (!transfer) {
                logger.debug(`[IBCTransferService] No transfer found for packet ${sourcePort}/${sourceChannel}/${sequence}`);
                return;
            }
            
            // Check if the acknowledgment contains an error
            const isSuccessful = !attributes.packet_ack_error && !attributes.error;
            
            // Update the transfer record
            const updatedTransfer = {
                ...transfer,
                status: isSuccessful ? 'COMPLETED' : 'FAILED',
                success: isSuccessful,
                completion_tx_hash: txHash,
                completion_height: height,
                completion_timestamp: timestamp,
                error: attributes.packet_ack_error || attributes.error || undefined,
                updated_at: timestamp
            };
            
            await this.transferRepository.saveTransfer(updatedTransfer, packetId, network);
            
            logger.info(`[IBCTransferService] Transfer ${isSuccessful ? 'completed' : 'failed'}: ${sourcePort}/${sourceChannel}/${sequence} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCTransferService] Error processing acknowledgment event: ${error instanceof Error ? error.message : String(error)}`);
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
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCTransferService] Processing timeout event in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.extractEventAttributes(event);
            
            // Get packet details to identify the transfer
            const sourcePort = attributes.packet_src_port;
            const sourceChannel = attributes.packet_src_channel;
            const sequence = attributes.packet_sequence;
            
            if (!sourcePort || !sourceChannel || !sequence) {
                logger.warn(`[IBCTransferService] Missing required packet attributes for timeout event`);
                return;
            }
            
            // Create packet ID using the same method used for initial transfer
            const packetId = this.createPacketId(sourcePort, sourceChannel, sequence);
            
            // Find the associated transfer
            const transfer = await this.transferRepository.getTransferByPacketId(packetId, network);
            
            if (!transfer) {
                logger.debug(`[IBCTransferService] No transfer found for packet ${sourcePort}/${sourceChannel}/${sequence}`);
                return;
            }
            
            // Update the transfer as failed due to timeout
            const updatedTransfer = {
                ...transfer,
                status: 'TIMEOUT',
                success: false,
                timeout_tx_hash: txHash,
                timeout_height: height,
                timeout_timestamp: timestamp,
                error: 'Packet timed out',
                updated_at: timestamp
            };
            
            await this.transferRepository.saveTransfer(updatedTransfer, packetId, network);
            
            logger.info(`[IBCTransferService] Transfer timed out: ${sourcePort}/${sourceChannel}/${sequence} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCTransferService] Error processing timeout event: ${error instanceof Error ? error.message : String(error)}`);
        }
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
    
    /**
     * Create a packet ID using port, channel, and sequence
     * This creates a unique identifier for the packet that can be used across different events
     */
    private createPacketId(port: string, channel: string, sequence: string): mongoose.Types.ObjectId {
        // Create a deterministic ID by hashing the packet details
        const packetKey = `${port}/${channel}/${sequence}`;
        
        // Use a hashed ObjectId to ensure consistent references across events
        const hash = Buffer.from(packetKey).toString('hex').substring(0, 24);
        return new mongoose.Types.ObjectId(hash);
    }
    
    /**
     * Extract a readable token symbol from a denom
     * @param denom The IBC denom string (e.g., 'ubbn', 'ibc/1234...', 'transfer/channel-1/uatom')
     * @returns A human-readable symbol 
     */
    private extractTokenSymbol(denom: string): string {
        if (!denom) return 'UNKNOWN';
        
        // Handle native denominations
        if (denom === 'ubbn') return 'BABY';
        
        // Handle common IBC tokens
        if (denom.startsWith('ibc/')) {
            return 'IBC';
        }
        
        // Handle transfer format: e.g., transfer/channel-1/uatom
        if (denom.includes('/')) {
            const parts = denom.split('/');
            // Get the last part which usually contains the actual denom
            const baseDenom = parts[parts.length - 1] || '';
            
            // Common denomination prefixes to transform
            if (baseDenom.startsWith('u')) return baseDenom.substring(1).toUpperCase();
            if (baseDenom.startsWith('a')) return baseDenom.substring(1).toUpperCase();
            
            return baseDenom.toUpperCase();
        }
        
        return denom.toUpperCase();
    }
    
    /**
     * Format token amount for human-readable display
     * @param amount Amount in smallest unit (e.g., 1000000)
     * @param symbol Token symbol for denomination factor
     * @returns Formatted amount string
     */
    private formatTokenAmount(amount: string, symbol: string): string {
        try {
            const numericAmount = BigInt(amount);
            
            // Different tokens have different denomination factors
            let denomFactor = BigInt(1000000); // Default for most cosmos tokens (6 decimals)
            
            if (symbol === 'BABY' || symbol === 'ATOM' || symbol === 'OSMO') {
                denomFactor = BigInt(1000000); // 6 decimals
            } else if (symbol === 'BTC') {
                denomFactor = BigInt(100000000); // 8 decimals
            } else if (symbol === 'ETH') {
                denomFactor = BigInt(1000000000000000000); // 18 decimals
            }
            
            if (denomFactor === BigInt(1)) {
                return amount;
            }
            
            // Handle the division safely using BigInt
            const wholePart = numericAmount / denomFactor;
            const fractionalPart = numericAmount % denomFactor;
            
            // Format with proper decimal places
            const decimals = denomFactor.toString().length - 1;
            let fractionalString = fractionalPart.toString().padStart(decimals, '0');
            
            // Trim trailing zeros
            fractionalString = fractionalString.replace(/0+$/, '');
            
            if (fractionalString) {
                return `${wholePart}.${fractionalString}`;
            } else {
                return wholePart.toString();
            }
        } catch (error) {
            logger.warn(`[IBCTransferService] Error formatting amount ${amount}: ${error instanceof Error ? error.message : String(error)}`);
            return amount;
        }
    }
}
