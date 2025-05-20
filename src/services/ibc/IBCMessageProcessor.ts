import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { BaseMessageProcessor } from '../websocket/WebSocketMessageService';
import { IBCEventHandler } from './IBCEventHandler';
import { decodeTx } from '../decoders/transaction';

/**
 * Message processor for IBC-related events received via websocket
 * Integrates with the existing WebSocketMessageService architecture
 */
export class IBCMessageProcessor extends BaseMessageProcessor {
    constructor(private ibcEventHandler: IBCEventHandler) {
        super();
    }

    /**
     * Check if this processor can handle the received message
     * @param message WebSocket message
     * @returns true if this processor can handle the message
     */
    canProcess(message: any): boolean {
        // Check if this is an IBC-related transaction message
        return (
            // Check for IBC-specific subscription
            (message.id === 'ibc' && 
             message?.result?.data?.value?.TxResult?.result?.events) || 
            // Or check for general transaction with IBC module in message attributes
            (message.id === 'new_tx' &&
             message?.result?.data?.value?.TxResult?.result?.events &&
             this.containsIBCModule(message?.result?.data?.value?.TxResult?.result?.events))
        );
    }

    /**
     * Process an IBC-related websocket message
     * @param message WebSocket message
     * @param network Network where the transaction occurred
     */
    async process(message: any, network: Network): Promise<void> {
        try {
            const messageValue = message.result.data.value;
            const height = parseInt(message.result.events['tx.height']?.[0]);
            
            const hash = message.result.events['tx.hash']?.[0];
            const txBase64 = messageValue.TxResult.tx;
            const events = messageValue.TxResult.result.events;
            const timestamp = new Date().toISOString(); // Get current timestamp or extract from message if available
            
            // Extract signer information using the decoder service
            let signer: string = '';
            if (txBase64) {
                try {
                    const decodedTx = decodeTx(txBase64);
                    
                    // Extract signer directly from the IBC message content
                    // Each IBC message has its own signer field in the content
                    // For multiple IBC messages in a single transaction, the signer is the same for all messages
                    const ibcMessage = decodedTx.messages.find(msg => 
                        msg.typeUrl.startsWith('/ibc.') && 
                        msg.content && 
                        typeof msg.content === 'object' && 
                        'signer' in msg.content
                    );
                    
                    if (ibcMessage) {
                        signer = (ibcMessage.content as any).signer;
                        logger.debug(`[IBCMessageProcessor] Found IBC signer: ${signer}`);
                    }
                } catch (error) {
                    logger.error(`[IBCMessageProcessor] Error decoding transaction: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            const txData = {
                height,
                hash,
                events,
                signer,
                timestamp
            };

            if (txData.height && txData.hash && txData.events) {
                logger.debug(`[IBCMessageProcessor] Processing IBC transaction ${txData.hash} at height ${txData.height}`);
                await this.ibcEventHandler.handleEvent(txData, network);
            }
        } catch (error) {
            logger.error(`[IBCMessageProcessor] Error processing IBC message: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Helper method to check if events list contains an IBC module
     * @param events Transaction events
     * @returns true if IBC module found in message attributes
     */
    private containsIBCModule(events: any[]): boolean {
        if (!Array.isArray(events)) return false;
        
        // Look for message events with module attribute containing 'ibc'
        return events.some(event => 
            event.type === 'message' && 
            Array.isArray(event.attributes) &&
            event.attributes.some((attr: any) => 
                attr.key === 'module' && 
                typeof attr.value === 'string' && 
                attr.value.includes('ibc')
            )
        );
    }
}
