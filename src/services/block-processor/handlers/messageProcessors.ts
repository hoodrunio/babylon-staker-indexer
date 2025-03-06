/**
 * WebSocketMessageService yapısına uyumlu mesaj işleyicileri
 */

import { BlockTransactionHandler } from './BlockTransactionHandler';
import { logger } from '../../../utils/logger';
import { Network } from '../../../types/finality';

/**
 * Tüm mesaj işleyicileri için temel abstract sınıf
 */
export abstract class BaseMessageProcessor {
    abstract canProcess(message: any): boolean;
    abstract process(message: any, network: Network): Promise<void>;
}

/**
 * Blok mesajlarını işleyen processor
 */
export class BlockMessageProcessor extends BaseMessageProcessor {
    constructor(private blockHandler: BlockTransactionHandler) {
        super();
    }

    canProcess(message: any): boolean {
        try {
            return message?.result?.data?.type === 'tendermint/event/NewBlock';
        } catch {
            return false;
        }
    }

    async process(message: any, network: Network): Promise<void> {
        try {
            const blockData = message;
            logger.info(`[BlockMessageProcessor] Processing block at height ${blockData.header?.height}`);
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
 * Transaction mesajlarını işleyen processor
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
            
            logger.info(`[TransactionMessageProcessor] Processing tx ${txData.tx_hash} at height ${txData.TxResult.height}`);
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
 * BlockMessageProcessor ve TransactionMessageProcessor nesnelerini oluşturur
 * @param handler BlockTransactionHandler instance'ı
 * @returns Processor dizisi
 */
export function createBlockTxProcessors(handler: BlockTransactionHandler): BaseMessageProcessor[] {
    return [
        new BlockMessageProcessor(handler),
        new TransactionMessageProcessor(handler)
    ];
} 