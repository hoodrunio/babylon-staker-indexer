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
     * @param txSigner Optional transaction signer
     */
    public async processRelayerEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network,
        txSigner?: string
    ): Promise<void> {
        try {
            logger.debug(`[IBCRelayerService] Processing event for relayer tracking: ${event.type} in tx ${txHash}`);
            
            // For IBC transactions, the signer information comes directly from the message content
            // and is passed to us via the txSigner parameter
            
            // Extract event attributes once (we'll use these for both signer and packet info)
            const attributes = this.extractEventAttributes(event);
            
            // Use the transaction signer if available (extracted from the IBC message content)
            let signer = '';
            if (txSigner) {
                signer = txSigner;
                logger.debug(`[IBCRelayerService] Using IBC message signer as relayer: ${signer}`);
            }
            
            // If no signer from IBC message content, fall back to checking event attributes
            if (!signer) {
                signer = attributes.signer;
                
                if (signer) {
                    logger.debug(`[IBCRelayerService] Found signer in event attributes: ${signer}`);
                }
            }
            
            if (!signer) {
                // If we still can't identify the relayer, skip this event
                logger.debug(`[IBCRelayerService] Could not identify relayer for tx ${txHash}, skipping`);
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
            // Track if packet was successful or not
            let success = true;
            
            switch (event.type) {
                case 'recv_packet':
                    action = 'RECEIVE_PACKET';
                    // Check for error attribute
                    if (attributes.error || attributes.packet_error) {
                        success = false;
                    }
                    break;
                    
                case 'acknowledge_packet':
                    action = 'ACKNOWLEDGE_PACKET';
                    // Acknowledgments are generally considered successful
                    success = true;
                    break;
                    
                case 'timeout_packet':
                    action = 'TIMEOUT_PACKET';
                    // Timeouts indicate a failure to deliver within the expected timeframe
                    success = false;
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
                success,  // Track whether the relay was successful
                network: network.toString()
            };
            
            // Log success or failure for monitoring
            if (success) {
                logger.info(`[IBCRelayerService] Successful relay by ${signer} for ${sourcePort}/${sourceChannel}/${sequence}`);
            } else {
                logger.warn(`[IBCRelayerService] Failed relay by ${signer} for ${sourcePort}/${sourceChannel}/${sequence}`);
            }
            
            await this.relayerRepository.trackRelayerActivity(relayerData, network);
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
            return await this.relayerRepository.getRelayer(address, network);
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
