import { BabylonClient } from '../../../clients/BabylonClient';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCEventDispatcher } from '../event/IBCEventDispatcher';
import { EventContext } from '../interfaces/IBCEventProcessor';

/**
 * Specialized service for processing blocks to identify and extract IBC-related transactions
 * Following Single Responsibility Principle - focused only on block processing and event extraction
 */
export class IBCBlockProcessor {
    private babylonClient: BabylonClient;
    private eventDispatcher: IBCEventDispatcher;

    constructor(babylonClient: BabylonClient) {
        this.babylonClient = babylonClient;
        this.eventDispatcher = new IBCEventDispatcher();
        logger.info('[IBCBlockProcessor] Initialized');
    }

    /**
     * Process a block for IBC transactions
     * @param height Block height
     * @param network Network to process
     */
    public async processBlock(height: number, network: Network): Promise<void> {
        try {
            logger.debug(`[IBCBlockProcessor] Processing block at height ${height} for network ${network}`);
            
            // Get block data including transactions
            const blockResponse = await this.babylonClient.getBlockByHeight(height);
            
            if (!blockResponse || !blockResponse.result || !blockResponse.result.block) {
                logger.warn(`[IBCBlockProcessor] No valid block data returned for height ${height}`);
                return;
            }
            
            const block = blockResponse.result.block;
            const blockTime = new Date(block.header.time);
            
            // Get transactions in this block
            const txs = block.data?.txs || [];
            
            // Skip if no transactions
            if (!txs.length) {
                return;
            }

            // Process each transaction
            for (let i = 0; i < txs.length; i++) {
                try {
                    const txHash = Buffer.from(txs[i], 'base64').toString('hex');
                    
                    // Get transaction details - explicitly passing network parameter
                    const txResponse = await this.babylonClient.getTransaction(txHash);
                    
                    // Skip if no transaction response or events
                    if (!txResponse || !txResponse.result || !txResponse.result.tx_result || !txResponse.result.tx_result.events) {
                        continue;
                    }

                    // Extract events from transaction
                    const events = txResponse.result.tx_result.events;
                    
                    // Check if transaction contains IBC events
                    const hasIBCEvents = this.hasIBCEvents(events);

                    // Process IBC events if found
                    if (hasIBCEvents) {
                        const context: EventContext = {
                            height,
                            txHash,
                            timestamp: blockTime,
                            network
                        };
                        
                        // Delegate event processing to the event dispatcher
                        const txData = {
                            hash: txHash,
                            events: events
                        };
                        await this.eventDispatcher.dispatchEvents(txData, context, network);
                    }
                } catch (txError) {
                    logger.error(`[IBCBlockProcessor] Error processing transaction in block ${height}: ${txError instanceof Error ? txError.message : String(txError)}`);
                    // Continue processing other transactions
                }
            }
            
            logger.debug(`[IBCBlockProcessor] Completed processing block at height ${height}`);
        } catch (error) {
            logger.error(`[IBCBlockProcessor] Error processing block ${height}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Check if transaction events contain IBC-related data
     * @param events Transaction events
     * @returns true if IBC events found
     */
    private hasIBCEvents(events: any[]): boolean {
        return events.some(event => 
            event.type.startsWith('ibc') || 
            event.type.includes('channel') || 
            event.type.includes('client') || 
            event.type.includes('connection') || 
            event.type.includes('packet')
        );
    }
}
