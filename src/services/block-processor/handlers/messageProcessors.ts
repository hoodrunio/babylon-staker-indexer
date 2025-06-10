/**
 * Message processors compatible with WebSocketMessageService structure
 */

import { BlockTransactionHandler } from './BlockTransactionHandler';
import { logger } from '../../../utils/logger';
import { Network } from '../../../types/finality';

/**
 * Base abstract class for all message processors
 */
export abstract class BaseMessageProcessor {
    abstract canProcess(message: any): boolean;
    abstract process(message: any, network: Network): Promise<void>;
}

/**
 * Processor that processes block messages
 */
export class BlockMessageProcessor extends BaseMessageProcessor {
    constructor(private blockHandler: BlockTransactionHandler) {
        super();
    }

    canProcess(): boolean {
        try {
            // These types of messages are now handled by NewBlockMessageProcessor
            // Therefore, we return false here
            return false;
        } catch {
            return false;
        }
    }

    async process(message: any, network: Network): Promise<void> {
        try {
            const blockData = message;
            //logger.debug(`[BlockMessageProcessor] Processing block at height ${blockData.header?.height}`);
            await this.blockHandler.handleNewBlock(blockData, network);
        } catch (error) {
            logger.error(`[BlockMessageProcessor] Error processing block message: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error) {
                logger.debug(`[BlockMessageProcessor] Stack: ${error.stack}`);
            }
        }
    }
}

/**
 * Processor that processes transaction messages
 */
export class TransactionMessageProcessor extends BaseMessageProcessor {
    constructor(private blockHandler: BlockTransactionHandler) {
        super();
    }

    canProcess(message: any): boolean {
        try {
            return message?.result?.data?.type === 'tendermint/event/Tx';
        } catch {
            return false;
        }
    }

    async process(message: any, network: Network): Promise<void> {
        try {
            const txData = {
                TxResult: message.result.data.value.TxResult,
                tx_hash: message.result.events['tx.hash']?.[0] || ''
            };
            
            //logger.debug(`[TransactionMessageProcessor] Processing tx ${txData.tx_hash.substring(0, 8)}... at height ${txData.TxResult.height}`);
            await this.blockHandler.handleNewTransaction(txData, network);
        } catch (error) {
            logger.error(`[TransactionMessageProcessor] Error processing tx message: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error) {
                logger.debug(`[TransactionMessageProcessor] Stack: ${error.stack}`);
            }
        }
    }
}

/**
 * Creates BlockMessageProcessor and TransactionMessageProcessor objects
 * @param handler BlockTransactionHandler instance
 * @returns Processor array
 */
export function createBlockTxProcessors(handler: BlockTransactionHandler): BaseMessageProcessor[] {
    return [
        new BlockMessageProcessor(handler),
        new TransactionMessageProcessor(handler)
    ];
}