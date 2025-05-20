import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCTransferRepository } from '../repository/IBCTransferRepository';

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
            
            // Handle different transfer types
            switch (event.type) {
                case 'fungible_token_packet':
                case 'transfer_packet':
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
                        timestamp: timestamp,
                        status: 'SENT',
                        network: network.toString()
                    };
                    
                    await this.transferRepository.saveTransfer(transfer, network);
                    logger.info(`[IBCTransferService] Token transfer: ${transferData.amount} ${transferData.denom} from ${transferData.sender} to ${transferData.receiver} at height ${height}`);
                    break;
                    
                case 'recv_packet':
                    // Check if this is a completed transfer
                    const existingTransfer = await this.transferRepository.getTransfer(sourcePort, sourceChannel, sequence, network);
                    
                    if (existingTransfer) {
                        // Update status for existing transfer
                        const updatedTransfer = {
                            ...existingTransfer,
                            status: 'COMPLETED',
                            completion_tx_hash: txHash,
                            completion_height: height,
                            completion_timestamp: timestamp
                        };
                        
                        await this.transferRepository.saveTransfer(updatedTransfer, network);
                        logger.info(`[IBCTransferService] Token transfer completed: ${sourcePort}/${sourceChannel}/${sequence} at height ${height}`);
                    }
                    break;
                    
                case 'timeout_packet':
                    // Check if this is a timed-out transfer
                    const timedOutTransfer = await this.transferRepository.getTransfer(sourcePort, sourceChannel, sequence, network);
                    
                    if (timedOutTransfer) {
                        // Update status for timed-out transfer
                        const updatedTransfer = {
                            ...timedOutTransfer,
                            status: 'TIMEOUT',
                            timeout_tx_hash: txHash,
                            timeout_height: height,
                            timeout_timestamp: timestamp
                        };
                        
                        await this.transferRepository.saveTransfer(updatedTransfer, network);
                        logger.info(`[IBCTransferService] Token transfer timed out: ${sourcePort}/${sourceChannel}/${sequence} at height ${height}`);
                    }
                    break;
                    
                default:
                    logger.debug(`[IBCTransferService] Unhandled transfer event type: ${event.type}`);
            }
        } catch (error) {
            logger.error(`[IBCTransferService] Error processing transfer event: ${error instanceof Error ? error.message : String(error)}`);
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
