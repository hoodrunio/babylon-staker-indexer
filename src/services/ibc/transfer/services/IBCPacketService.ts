import { logger } from '../../../../utils/logger';
import { IIBCPacketService } from '../interfaces/IBCServices';
import { IBCEvent, IBCPacketInfo } from '../types/IBCTransferTypes';
import mongoose from 'mongoose';

/**
 * Service responsible for IBC packet operations
 */
export class IBCPacketService implements IIBCPacketService {
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
     * Extract packet information from event attributes
     * @param attributes Event attributes
     * @returns Packet information or null if required fields are missing
     */
    public extractPacketInfo(attributes: Record<string, string>): IBCPacketInfo | null {
        // Get packet details to identify the transfer
        const sourcePort = attributes.packet_src_port;
        const sourceChannel = attributes.packet_src_channel;
        const sequence = attributes.packet_sequence;
        const destPort = attributes.packet_dst_port;
        const destChannel = attributes.packet_dst_channel;
        
        if (!sourcePort || !sourceChannel || !sequence) {
            logger.warn(`[IBCPacketService] Missing required packet attributes`);
            return null;
        }
        
        // Create packet ID using the method
        const packetId = this.createPacketId(sourcePort, sourceChannel, sequence).toString();
        
        return {
            sourcePort,
            sourceChannel,
            destPort: destPort || '',
            destChannel: destChannel || '',
            sequence,
            packetId
        };
    }
}
