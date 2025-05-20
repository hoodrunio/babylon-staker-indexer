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
            // Different event types may have packet data in different attributes
            let packetData = attributes.packet_data || attributes.data;
            
            // Handle the cases where packet data might be missing
            if (!packetData) {
                // Look for IBC ack packet success/errors
                if (event.type === 'acknowledge_packet' || event.type === 'write_acknowledgement') {
                    // For acks, we only need packet routing info which we already have
                    // So we can just continue processing even without packet data
                    logger.debug(`[IBCTransferService] Processing acknowledgment without packet data`);
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
                        logger.debug(`[IBCTransferService] Reconstructed packet data from fungible_token_packet attributes`);
                    } else {
                        logger.warn(`[IBCTransferService] Missing packet_data and required attributes for transfer event`);
                        return;
                    }
                } else {
                    logger.warn(`[IBCTransferService] Missing packet_data for transfer event type: ${event.type}`);
                    return;
                }
            }
            
            let transferData;
            try {
                // Try to parse packet data as JSON
                if (typeof packetData === 'string') {
                    transferData = JSON.parse(packetData);
                } else {
                    transferData = packetData;
                }
                
                // Log parsed transfer data for debugging
                logger.debug(`[IBCTransferService] Parsed transfer data: ${JSON.stringify(transferData).substring(0, 200)}...`);
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
            
            // Log the packet ID creation for debugging
            logger.debug(`[IBCTransferService] Created packet ID: ${packetId} for packet: ${sourcePort}/${sourceChannel}/${sequence}`);
            
            // Handle different transfer types
            switch (event.type) {
                case 'send_packet':
                case 'fungible_token_packet':
                case 'transfer_packet': {
                    // Extract client and connection information from channel if available
                    const sourceChainId = attributes.source_chain || attributes.chain_id;
                    const destChainId = attributes.destination_chain || attributes.counterparty_chain_id;
                    
                    // Format token information for display
                    const tokenSymbol = this.extractTokenSymbol(transferData.denom);
                    const displayAmount = this.formatTokenAmount(transferData.amount, tokenSymbol);
                    
                    // Create a unique packet key for tracing/debugging
                    const packetKey = `${sourcePort}/${sourceChannel}/${sequence}`;
                    
                    // Generate the packet ID for consistent reference (only once)
                    const packetId = this.createPacketId(sourcePort, sourceChannel, sequence);
                    
                    // Log the packet information for debugging
                    logger.debug(`[IBCTransferService] Processing transfer with packet key: ${packetKey} and packetId: ${packetId}`);

                    
                    // Basic transfer data fields - match schema exactly
                    const transfer = {
                        // Packet identification - don't include in transfer object
                        // packet_id will be handled by repository
                        
                        // Transfer details
                        sender: transferData.sender,
                        receiver: transferData.receiver,
                        denom: transferData.denom,
                        amount: transferData.amount,
                        
                        // Transaction metadata
                        tx_hash: txHash,
                        
                        // Timing information - match schema field name
                        send_time: timestamp,
                        
                        // Status tracking
                        success: false,
                        
                        // Display information
                        token_symbol: tokenSymbol,
                        token_display_amount: displayAmount,
                        
                        // Chain information
                        source_chain_id: sourceChainId || 'babylonchain',
                        destination_chain_id: destChainId || 'unknown',
                        
                        // Network
                        network: network.toString()
                    };
                    
                    try {
                        logger.debug(`[IBCTransferService] Saving transfer with packet_id=${packetId} for packet ${packetKey}`);
                        const savedTransfer = await this.transferRepository.saveTransfer(transfer, packetId, network);
                        
                        if (savedTransfer) {
                            logger.info(`[IBCTransferService] Token transfer saved: ${transferData.amount} ${transferData.denom} from ${transferData.sender} to ${transferData.receiver} at height ${height}`);
                        } else {
                            logger.error(`[IBCTransferService] Failed to save transfer for packet ${packetKey}`);
                        }
                    } catch (err) {
                        logger.error(`[IBCTransferService] Error saving transfer: ${err instanceof Error ? err.message : String(err)}`);
                    }
                    break;
                }
                    
                case 'acknowledge_packet': {
                    logger.debug(`[IBCTransferService] Processing acknowledgment event in tx ${txHash}`);
                    
                    // Create a unique packet key for tracing/debugging
                    const packetKey = `${sourcePort}/${sourceChannel}/${sequence}`;
                    
                    // Generate packet ID for looking up transfer
                    const packetId = this.createPacketId(sourcePort, sourceChannel, sequence);
                    
                    // Get the acknowledgement status
                    const isSuccessful = this.isSuccessfulAcknowledgement(attributes);
                    
                    // Check if this is a completed transfer
                    const existingTransfer = await this.transferRepository.getTransferByPacketId(packetId, network);
                    
                    if (existingTransfer) {
                        try {
                            // Extract only the original fields from _doc to prevent data loss
                            // This ensures we don't lose required fields during the update
                            const originalData = existingTransfer._doc || existingTransfer;
                            
                            // Create update fields that will be merged with original data
                            const updateFields = {
                                // Update success flag based on ack result
                                success: isSuccessful,
                                
                                // Add completion information
                                complete_time: timestamp,
                                
                                // Add additional metadata for debugging
                                updated_at: timestamp
                            };
                            
                            // Combine original data with update fields
                            // This ensures all original fields are preserved
                            const updatedTransfer = {
                                ...originalData,  // Keep all original fields
                                ...updateFields   // Apply updates
                            };
                            
                            // Save the updated transfer
                            const savedTransfer = await this.transferRepository.saveTransfer(updatedTransfer, packetId, network);
                            
                            if (savedTransfer) {
                                logger.info(`[IBCTransferService] Token transfer ${isSuccessful ? 'completed' : 'failed'}: ${packetKey} at height ${height}`);
                            } else {
                                logger.error(`[IBCTransferService] Failed to update transfer for packet ${packetKey}`);
                            }
                        } catch (error) {
                            logger.error(`[IBCTransferService] Error updating transfer: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    } else {
                        // Log detailed debugging info if transfer not found
                        logger.warn(`[IBCTransferService] No transfer found for packet ${packetKey}, packetId=${packetId}`);
                        
                        // Try to find transfer by tx hash as fallback
                        const sendTxHash = attributes.packet_tx_hash || attributes.packet_ack_tx_hash;
                        if (sendTxHash) {
                            logger.debug(`[IBCTransferService] Trying to find transfer by tx hash: ${sendTxHash}`);
                            const transferByTx = await this.transferRepository.getTransferByTxHash(sendTxHash, network);
                            if (transferByTx) {
                                logger.info(`[IBCTransferService] Found transfer by tx hash instead of packetId`);
                            } else {
                                logger.warn(`[IBCTransferService] No transfer found by tx hash: ${sendTxHash}`);
                            }
                        }
                    }
                    break;
                }
                    
                case 'timeout_packet': {
                    logger.debug(`[IBCTransferService] Processing timeout event in tx ${txHash}`);
                    
                    // Create a unique packet key for tracing/debugging
                    const packetKey = `${sourcePort}/${sourceChannel}/${sequence}`;
                    
                    // Generate packet ID for looking up transfer
                    const packetId = this.createPacketId(sourcePort, sourceChannel, sequence);
                    
                    // Check if this is a timed-out transfer
                    const timedOutTransfer = await this.transferRepository.getTransferByPacketId(packetId, network);
                    
                    if (timedOutTransfer) {
                        try {
                            // Extract only the original fields from _doc to prevent data loss
                            const originalData = timedOutTransfer._doc || timedOutTransfer;
                            
                            // Create update fields that will be merged with original data
                            const updateFields = {
                                success: false, // Timeout is never successful
                                updated_at: timestamp,
                                timeout_time: timestamp,  // Match schema field name
                                timeout_tx_hash: txHash,
                                timeout_height: height
                            };
                            
                            // Combine original data with update fields
                            // This ensures all original fields are preserved
                            const updatedTransfer = {
                                ...originalData,  // Keep all original fields
                                ...updateFields   // Apply updates
                            };
                            
                            const savedTransfer = await this.transferRepository.saveTransfer(updatedTransfer, packetId, network);
                            if (savedTransfer) {
                                logger.info(`[IBCTransferService] Token transfer timed out: ${packetKey} at height ${height}`);
                            } else {
                                logger.error(`[IBCTransferService] Failed to update timed-out transfer for packet ${packetKey}`);
                            }
                        } catch (error) {
                            logger.error(`[IBCTransferService] Error updating timed-out transfer: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    } else {
                        logger.warn(`[IBCTransferService] No transfer found for timed-out packet ${packetKey}, packetId=${packetId}`);
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
            
            logger.info(`[IBCTransferService] Transfer ${isSuccessful ? 'completed' : 'failed'}: ${sourcePort}/${sourceChannel}/${sequence} from ${transfer.sender} to ${transfer.receiver} (${transfer.amount} ${transfer.denom}) at height ${height}`);
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
            
            logger.info(`[IBCTransferService] Transfer timed out: ${sourcePort}/${sourceChannel}/${sequence} from ${transfer.sender} to ${transfer.receiver} (${transfer.amount} ${transfer.denom}) at height ${height}`);
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
        // Create a deterministic ID by properly hashing the packet details
        const packetKey = `${port}/${channel}/${sequence}`;
        
        // Use crypto to create a proper hash
        let hash = '';
        try {
            // Create a hash using Node.js crypto module
            const crypto = require('crypto');
            // Use MD5 which produces a 32 character hex string
            hash = crypto.createHash('md5').update(packetKey).digest('hex').substring(0, 24);
        } catch (error) {
            // Fallback method if crypto isn't available
            // Simple but consistent hash function
            let hashCode = 0;
            for (let i = 0; i < packetKey.length; i++) {
                hashCode = ((hashCode << 5) - hashCode) + packetKey.charCodeAt(i);
                hashCode = hashCode & hashCode; // Convert to 32bit integer
            }
            // Convert to positive hex and ensure it's 24 chars
            hash = (Math.abs(hashCode).toString(16) + '000000000000000000000000').substring(0, 24);
        }
        
        logger.debug(`[IBCTransferService] Created packet ID: ${hash} for packet: ${packetKey}`);
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

    /**
     * Determine if an acknowledgment was successful based on event attributes
     */
    private isSuccessfulAcknowledgement(attributes: Record<string, string>): boolean {
        // First check for explicit error indicators
        if (attributes.packet_ack_error || attributes.error) {
            logger.debug(`[IBCTransferService] Ack contains error: ${attributes.packet_ack_error || attributes.error}`);
            return false;
        }
        
        // Check the packet_ack field which contains the acknowledgment
        const ack = attributes.packet_ack;
        if (ack) {
            // All successful acks have a 'result' field with a value
            // Failed acks will have an 'error' field instead
            try {
                const parsed = JSON.parse(ack);
                // If there's a result field, it's a success
                if (parsed.result) {
                    return true;
                }
                // If there's an error field, it's a failure
                if (parsed.error) {
                    return false;
                }
            } catch (e) {
                // If we can't parse the JSON, check if it contains error text
                if (ack.toLowerCase().includes('error')) {
                    return false;
                }
            }
        }
        
        // Default to true as most acks are successful
        // This is a safe default since failures are explicitly indicated
        logger.debug(`[IBCTransferService] No explicit ack status found in attributes: ${JSON.stringify(attributes)}`);
        return true;
    }
}
