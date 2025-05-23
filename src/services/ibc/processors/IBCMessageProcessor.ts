import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { BaseMessageProcessor } from '../../websocket/WebSocketMessageService';
import { IBCEventHandler, TransactionData } from '../events/IBCEventHandler';
import { decodeTx } from '../../decoders/transaction';

/**
 * Refactored message processor for IBC-related events
 * Simplified and focused on WebSocket message processing
 */
export class IBCMessageProcessor extends BaseMessageProcessor {
    constructor(private readonly eventHandler: IBCEventHandler) {
        super();
    }

    /**
     * Check if this processor can handle the received message
     */
    canProcess(message: any): boolean {
        try {
            // Check for IBC-specific subscription
            if (message.id === 'ibc' && message?.result?.data?.value?.TxResult?.result?.events) {
                return true;
            }
            
            // Check for general transaction with IBC module in message attributes
            if (message.id === 'new_tx' && 
                message?.result?.data?.value?.TxResult?.result?.events) {
                return this.containsIBCModule(message.result.data.value.TxResult.result.events);
            }
            
            return false;
        } catch (error) {
            logger.debug(`[IBCMessageProcessor] Error checking message: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Process an IBC-related websocket message
     */
    async process(message: any, network: Network): Promise<void> {
        try {
            const txData = this.extractTransactionData(message);
            
            if (!this.isValidTransactionData(txData)) {
                logger.warn('[IBCMessageProcessor] Invalid transaction data received');
                return;
            }

            logger.debug(`[IBCMessageProcessor] Processing IBC transaction ${txData.hash} at height ${txData.height}`);
            await this.eventHandler.handleEvent(txData, network);
        } catch (error) {
            logger.error(`[IBCMessageProcessor] Error processing IBC message: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Extract transaction data from WebSocket message
     */
    private extractTransactionData(message: any): TransactionData | null {
        try {
            const messageValue = message.result.data.value;
            const height = parseInt(message.result.events['tx.height']?.[0]);
            const hash = message.result.events['tx.hash']?.[0];
            const txBase64 = messageValue.TxResult.tx;
            const events = messageValue.TxResult.result.events;
            const timestamp = new Date().toISOString();
            
            // Extract signer information
            const signer = this.extractSigner(txBase64);
            
            return {
                height,
                hash,
                events,
                signer,
                timestamp
            };
        } catch (error) {
            logger.error(`[IBCMessageProcessor] Error extracting transaction data: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Extract signer from transaction data
     */
    private extractSigner(txBase64: string): string {
        if (!txBase64) return '';
        
        try {
            const decodedTx = decodeTx(txBase64);
            
            // Find IBC message with signer field
            const ibcMessage = decodedTx.messages.find(msg => 
                msg.typeUrl.startsWith('/ibc.') && 
                msg.content && 
                typeof msg.content === 'object' && 
                'signer' in msg.content
            );
            
            if (ibcMessage) {
                const signer = (ibcMessage.content as any).signer;
                logger.debug(`[IBCMessageProcessor] Found IBC signer: ${signer}`);
                return signer;
            }
        } catch (error) {
            logger.debug(`[IBCMessageProcessor] Error decoding transaction: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        return '';
    }

    /**
     * Validate transaction data
     */
    private isValidTransactionData(txData: TransactionData | null): txData is TransactionData {
        return !!(txData && txData.height && txData.hash && txData.events);
    }

    /**
     * Check if events contain IBC module
     */
    private containsIBCModule(events: any[]): boolean {
        if (!Array.isArray(events)) return false;
        
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