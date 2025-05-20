import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { BaseMessageProcessor } from '../websocket/WebSocketMessageService';
import { IBCEventHandler } from './IBCEventHandler';

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
        // We can process messages either from a specific IBC subscription or
        // general tx messages that contain IBC events
        return (
            // Check for IBC-specific subscription
            (message.id === 'ibc' && 
             message?.result?.data?.value?.TxResult?.result?.events) || 
            // Or check for general transaction with IBC-related events
            (message.id === 'new_tx' &&
             message?.result?.data?.value?.TxResult?.result?.events &&
             this.containsIBCEvents(message?.result?.data?.value?.TxResult?.result?.events))
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
            
            const txData = {
                height,
                hash: message.result.events['tx.hash']?.[0],
                events: messageValue.TxResult.result.events
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
     * Helper method to check if events list contains IBC-related events
     * @param events Transaction events
     * @returns true if IBC events found
     */
    private containsIBCEvents(events: any[]): boolean {
        if (!Array.isArray(events)) return false;
        
        return events.some(event => 
            event.type.startsWith('ibc.') || 
            event.type.includes('channel') || 
            event.type.includes('client') || 
            event.type.includes('connection') || 
            event.type.includes('packet')
        );
    }
}
