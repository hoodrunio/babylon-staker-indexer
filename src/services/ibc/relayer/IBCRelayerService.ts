import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCRelayerRepository } from '../repository/IBCRelayerRepository';

/**
 * Service responsible for tracking and managing IBC relayers
 * Following Single Responsibility Principle - focuses only on relayer operations
 */
export class IBCRelayerService {
    private relayerRepository: IBCRelayerRepository;

    constructor() {
        this.relayerRepository = new IBCRelayerRepository();
    }

    /**
     * Process an event to identify and track relayers
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processRelayerEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCRelayerService] Processing event for relayer tracking: ${event.type} in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.extractEventAttributes(event);
            
            // For relayers, we need to extract the signer from the transaction
            const signer = attributes.signer;
            
            if (!signer) {
                // If signer attribute is not present, we can't identify the relayer
                return;
            }
            
            // Extract packet information from event
            const sourcePort = attributes.packet_src_port;
            const sourceChannel = attributes.packet_src_channel;
            const sequence = attributes.packet_sequence;
            
            if (!sourcePort || !sourceChannel || !sequence) {
                // If packet info is missing, we can't associate with specific packet
                return;
            }
            
            // Determine the relayer action based on event type
            let action = '';
            switch (event.type) {
                case 'recv_packet':
                    action = 'RECEIVE_PACKET';
                    break;
                case 'acknowledge_packet':
                    action = 'ACKNOWLEDGE_PACKET';
                    break;
                case 'timeout_packet':
                    action = 'TIMEOUT_PACKET';
                    break;
                default:
                    // Other packet events are not typically relayed
                    return;
            }
            
            // Create relayer activity record
            const relayerData = {
                address: signer,
                tx_hash: txHash,
                height,
                timestamp,
                action,
                source_port: sourcePort,
                source_channel: sourceChannel,
                sequence,
                network: network.toString()
            };
            
            await this.relayerRepository.saveRelayerActivity(relayerData, network);
            logger.info(`[IBCRelayerService] Recorded relayer activity: ${signer} ${action} at height ${height}`);
        } catch (error) {
            logger.error(`[IBCRelayerService] Error processing relayer event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get statistics for a specific relayer
     * @param address Relayer address
     * @param network Network to query
     */
    public async getRelayerStats(address: string, network: Network): Promise<any> {
        try {
            return await this.relayerRepository.getRelayerStats(address, network);
        } catch (error) {
            logger.error(`[IBCRelayerService] Error getting relayer stats: ${error instanceof Error ? error.message : String(error)}`);
            return null;
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
}
