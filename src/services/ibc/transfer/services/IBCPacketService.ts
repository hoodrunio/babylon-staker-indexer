import { logger } from '../../../../utils/logger';
import { IIBCPacketService } from '../interfaces/IBCServices';
import { IBCEvent, IBCPacketInfo } from '../types/IBCTransferTypes';
import mongoose from 'mongoose';

// Transaction context to maintain information across multiple events in the same transaction
interface TransactionContext {
    packetInfo?: IBCPacketInfo;
    lastEventType?: string;
}

/**
 * Service responsible for IBC packet operations
 */
export class IBCPacketService implements IIBCPacketService {
    // Map to store transaction context keyed by transaction hash
    private transactionContextMap: Map<string, TransactionContext> = new Map();
    
    /**
     * Extract attributes from an event into a key-value map
     */
    public extractEventAttributes(event: IBCEvent): Record<string, string> {
        const attributes: Record<string, string> = {};
        
        if (!event.attributes || !Array.isArray(event.attributes)) {
            return attributes;
        }
        
        for (const attr of event.attributes) {
            if (attr.key && attr.value !== undefined) {
                attributes[attr.key] = attr.value;
            }
        }
        
        return attributes;
    }
    
    /**
     * Create a packet ID using port, channel, and sequence
     * This creates a unique identifier for the packet that can be used across different events
     */
    public createPacketId(port: string, channel: string, sequence: string): mongoose.Types.ObjectId {
        // Create a deterministic ID by properly hashing the packet details
        const packetKey = `${port}/${channel}/${sequence}`;
        
        // Use crypto to create a proper hash
        let hash = '';
        try {
            // Create a hash using Node.js crypto module
            // eslint-disable-next-line @typescript-eslint/no-var-requires
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
        
        logger.debug(`[IBCPacketService] Created packet ID: ${hash} for packet: ${packetKey}`);
        return new mongoose.Types.ObjectId(hash);
    }
    
    /**
     * Extract packet information from event attributes with improved robustness
     * @param attributes Event attributes
     * @returns Packet information or null if required fields are missing
     */
    public extractPacketInfo(attributes: Record<string, string>): IBCPacketInfo | null {
        try {
            // Different event types may have attributes in different formats
            // First look for the standard naming convention
            let sourcePort = attributes.packet_src_port || attributes.source_port;
            let sourceChannel = attributes.packet_src_channel || attributes.source_channel;
            let sequence = attributes.packet_sequence || attributes.sequence;
            let destPort = attributes.packet_dst_port || attributes.destination_port;
            let destChannel = attributes.packet_dst_channel || attributes.destination_channel;
            
            // Check if we have the minimum required info
            if (!sourcePort || !sourceChannel || !sequence) {
                // If missing standard attributes, check if we can extract from other attributes
                // Like in fungible_token_packet events where info might be in different format
                
                // For fungible_token_packet events, we might need to reconstruct packet info
                // from other available attributes like module, sender, receiver
                if (attributes.module === 'transfer' && attributes.sender && attributes.receiver) {
                    // Try to get sequence from a different attribute
                    if (!sequence) {
                        // Try to extract from connection_id or other attributes 
                        // For fungible_token_packet, the connection ID typically contains useful info
                        const connectionId = attributes.connection_id;
                        if (connectionId) {
                            // In some cases we can determine packet details from connection
                            logger.debug(`[IBCPacketService] Attempting to extract packet info from connection_id: ${connectionId}`);
                            
                            // If it's an IBC transfer event with a connection, check if we have port/channel in other attributes
                            if (attributes.packet_connection || attributes.connection_id) {
                                sourcePort = sourcePort || 'transfer'; // Default for IBC transfers
                                destPort = destPort || 'transfer'; // Default for IBC transfers
                                
                                // Try to get channels/sequence from event context
                                if (!sequence && attributes.msg_index) {
                                    // If we have a message index, we can use it as last resort for tracking
                                    sequence = attributes.msg_index;
                                    logger.debug(`[IBCPacketService] Using msg_index as sequence: ${sequence}`);
                                }
                            }
                        }
                    }
                }
                
                // If we still don't have required fields, log a warning and return null
                if (!sourcePort || !sourceChannel || !sequence) {
                    logger.warn(`[IBCPacketService] Missing required packet attributes after attempted reconstruction`);
                    logger.debug(`[IBCPacketService] Available attributes: ${JSON.stringify(attributes)}`);
                    return null;
                }
            }
            
            // Create packet ID using the method
            const packetId = this.createPacketId(sourcePort, sourceChannel, sequence).toString();
            
            // Return the packet info with all available data
            return {
                sourcePort,
                sourceChannel,
                destPort: destPort || '',
                destChannel: destChannel || '',
                sequence,
                packetId
            };
        } catch (error) {
            logger.error(`[IBCPacketService] Error extracting packet info: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    
    /**
     * Handle different packet event types with appropriate processing
     * @param eventType The event type (send_packet, recv_packet, etc)
     * @param attributes Event attributes
     * @param txHash Transaction hash (used to maintain context across events)
     * @returns The processed packet info or null if not handled
     */
    public handlePacketEvent(eventType: string, attributes: Record<string, string>, txHash: string): IBCPacketInfo | null {
        // Get or create transaction context
        let txContext = this.getTransactionContext(txHash);
        
        switch (eventType) {
            case 'send_packet':
            case 'recv_packet':
            case 'acknowledge_packet':
            case 'timeout_packet': {
                // Standard packet events with all required attributes
                const packetInfo = this.extractPacketInfo(attributes);
                
                // Store this packet info in the transaction context for potential future events
                if (packetInfo) {
                    txContext.packetInfo = packetInfo;
                    txContext.lastEventType = eventType;
                    this.updateTransactionContext(txHash, txContext);
                }
                
                return packetInfo;
            }
                
            case 'fungible_token_packet': {
                // Special handling for fungible token packets
                logger.debug(`[IBCPacketService] Processing fungible_token_packet with attributes: ${JSON.stringify(attributes)}`);
                
                // First try to extract packet info directly from the attributes
                const tokenPacketInfo = this.extractPacketInfo(attributes);
                
                // If we have complete packet info, use it
                if (tokenPacketInfo && tokenPacketInfo.sourcePort && tokenPacketInfo.sourceChannel && tokenPacketInfo.sequence) {
                    return tokenPacketInfo;
                }
                
                // If we don't have complete info, check if we have context from a previous event in this tx
                if (txContext.packetInfo) {
                    logger.debug(`[IBCPacketService] Using packet info from previous event in tx ${txHash}: ${JSON.stringify(txContext.packetInfo)}`);
                    return txContext.packetInfo;
                }
                
                // If we still don't have info, log and return null
                logger.debug(`[IBCPacketService] No packet context available for fungible_token_packet in tx ${txHash}`);
                return null;
            }
                
            default:
                logger.debug(`[IBCPacketService] Unhandled packet event type: ${eventType}`);
                return null;
        }
    }
    
    /**
     * Get transaction context from the map or create a new one
     */
    private getTransactionContext(txHash: string): TransactionContext {
        if (!this.transactionContextMap.has(txHash)) {
            this.transactionContextMap.set(txHash, {});
        }
        return this.transactionContextMap.get(txHash) || {};
    }
    
    /**
     * Update transaction context in the map
     */
    private updateTransactionContext(txHash: string, context: TransactionContext): void {
        this.transactionContextMap.set(txHash, context);
        
        // Clean up old contexts periodically to prevent memory leaks
        // We could implement a more sophisticated cleanup mechanism if needed
        if (this.transactionContextMap.size > 1000) {
            // Keep only the 500 most recent entries
            const keys = Array.from(this.transactionContextMap.keys());
            const keysToDelete = keys.slice(0, keys.length - 500);
            keysToDelete.forEach(key => this.transactionContextMap.delete(key));
        }
    }
}
