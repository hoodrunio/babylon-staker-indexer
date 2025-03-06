/**
 * Blok ve İşlem Handler Servisi
 * Websocket üzerinden gelen blok ve tx eventlerini işleyen ve veritabanına kaydeden servis.
 */

import { BlockProcessorError, TxProcessorError } from '../types/common';
import { IBlockProcessorService, IBlockStorage, ITransactionProcessorService, ITxStorage } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { Network } from '../../../types/finality';

/**
 * Block ve Transaction Handler için singleton class
 */
export class BlockTransactionHandler {
    private static instance: BlockTransactionHandler | null = null;
    private blockStorage: IBlockStorage | null = null;
    private txStorage: ITxStorage | null = null;
    private blockProcessor: IBlockProcessorService | null = null;
    private txProcessor: ITransactionProcessorService | null = null;
    private rpcClient: any | null = null;

    /**
     * Singleton instance oluşturur veya mevcut instance'ı döndürür
     */
    public static getInstance(): BlockTransactionHandler {
        if (!BlockTransactionHandler.instance) {
            BlockTransactionHandler.instance = new BlockTransactionHandler();
        }
        return BlockTransactionHandler.instance;
    }

    /**
     * Gerekli servisleri ayarlar
     */
    public initialize(
        blockStorage: IBlockStorage, 
        txStorage: ITxStorage, 
        blockProcessor: IBlockProcessorService,
        txProcessor: ITransactionProcessorService,
        rpcClient: any
    ): void {
        this.blockStorage = blockStorage;
        this.txStorage = txStorage;
        this.blockProcessor = blockProcessor;
        this.txProcessor = txProcessor;
        this.rpcClient = rpcClient;
        logger.info('[BlockTransactionHandler] Handler initialized');
    }

    /**
     * Yeni blok geldiğinde bu metod çağrılır ve bloğu işler
     */
    public async handleNewBlock(blockData: any, network: Network): Promise<void> {
        try {
            if (!this.blockProcessor || !this.blockStorage) {
                throw new BlockProcessorError('Block processor or storage not initialized');
            }

            if (blockData.result.data.value.block) {
                const block = await this.blockProcessor.processBlockFromWebsocket(blockData);
                await this.blockStorage.saveBlock(block, network);
                logger.info(`[BlockHandler-Websocket] Processed and saved block ${block.height} on ${network}`);
            }

            // Common servisini kullanarak bloğu işle
            const block = await this.blockProcessor.processBlock(blockData);
            
            // Bloğu veritabanına kaydet
            await this.blockStorage.saveBlock(block, network);
            
            logger.info(`[BlockHandler-Normal] Processed and saved block ${block.height} on ${network}`);
            
            // Blok işlendikten sonra yapılacak ek işlemler burada yapılabilir
            // Örneğin event aboneleri, diğer servislere bildirim vs.
            
        } catch (error) {
            logger.error(`[BlockHandler] Error processing block: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error) {
                logger.debug(`[BlockHandler] Error stack: ${error.stack}`);
            }
        }
    }

    /**
     * Yeni transaction geldiğinde bu metod çağrılır ve tx'i işler
     */
    public async handleNewTransaction(txData: any, network: Network): Promise<void> {
        try {
            if (!this.txProcessor || !this.txStorage) {
                throw new TxProcessorError('Transaction processor or storage not initialized');
            }
            
            // TxResult'tan gerekli alanları çıkar
            const txResult = txData.TxResult;
            const txHash = txData.tx_hash || '';
            const height = txResult.height;
            
            // Transaction processor'ı kullanarak işlemi process et
            const tx = await this.txProcessor.processTx({
                hash: txHash,
                height,
                tx: txResult.tx,
                tx_result: txResult.result
            });
            
            // İşlemi veritabanına kaydet
            await this.txStorage.saveTx(tx, network);
            
            logger.info(`[TxHandler] Processed and saved transaction ${tx.txHash} at height ${tx.height} on ${network}`);
            
            // İşlem başarılıysa yapılabilecek ek işlemler
            
        } catch (error) {
            logger.error(`[TxHandler] Error processing transaction: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error) {
                logger.debug(`[TxHandler] Error stack: ${error.stack}`);
            }
        }
    }

    /**
     * Geçmiş blokları senkronize eder
     */
    public async syncHistoricalBlocks(network: Network, fromHeight: number, toHeight?: number): Promise<void> {
        try {
            if (!this.rpcClient) {
                throw new BlockProcessorError('RPC client not initialized');
            }
            
            if (!this.blockProcessor) {
                throw new BlockProcessorError('Block processor not initialized');
            }
            
            // Mevcut blockchain yüksekliğini al
            const latestBlockInfo = await this.rpcClient.getLatestBlock();
            const currentHeight = parseInt(latestBlockInfo.block.header.height);
            
            // Hedef yüksekliği belirle
            const syncToHeight = toHeight ? Math.min(toHeight, currentHeight) : currentHeight;
            
            logger.info(`[BlockHandler] Syncing blocks from ${fromHeight} to ${syncToHeight} on ${network}...`);
            
            // Blocklari işle (burada basit bir senkron işlem yapıyoruz, paralel işleme eklenebilir)
            for (let height = fromHeight; height <= syncToHeight; height++) {
                await this.syncBlockAtHeight(height, network);
                
                // Her 100 blokta bir logging
                if (height % 100 === 0) {
                    logger.info(`[BlockHandler] Synced up to block ${height} (${Math.floor((height - fromHeight) * 100 / (syncToHeight - fromHeight + 1))}%)`);
                }
            }
            
            logger.info(`[BlockHandler] Historical sync completed: ${syncToHeight - fromHeight + 1} blocks processed on ${network}`);
            
        } catch (error) {
            logger.error(`[BlockHandler] Error syncing historical blocks: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error) {
                logger.debug(`[BlockHandler] Error stack: ${error.stack}`);
            }
            throw error;
        }
    }
    
    /**
     * Belirli bir yükseklikteki bloğu ve işlemlerini senkronize eder
     */
    private async syncBlockAtHeight(height: number, network: Network): Promise<void> {
        try {
            if (!this.blockProcessor || !this.txProcessor || !this.blockStorage || !this.txStorage) {
                throw new BlockProcessorError('Processors or storage not initialized');
            }
            
            // Bloğu al
            const blockData = await this.rpcClient.getBlockByHeight(height);
            
            // Bloğu işle
            const block = await this.blockProcessor.processBlock(blockData.block);
            
            // Bloğu veritabanına kaydet
            await this.blockStorage.saveBlock(block, network);
            
            // İşlemleri al ve işle
            if (blockData.block.data?.txs && blockData.block.data.txs.length > 0) {
                for (const encodedTx of blockData.block.data.txs) {
                    try {
                        // İşlem detayını al
                        const txDetail = await this.rpcClient.getTxByHash(encodedTx);
                        // İşlemi işle
                        const tx = await this.txProcessor.processTx(txDetail);
                        // İşlemi veritabanına kaydet
                        await this.txStorage.saveTx(tx, network);
                    } catch (txError) {
                        logger.error(`[TxHandler] Error processing tx in block ${height}: ${txError instanceof Error ? txError.message : String(txError)}`);
                    }
                }
            }
            
        } catch (error) {
            logger.error(`[BlockHandler] Error syncing block at height ${height}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Son blokları senkronize eder
     */
    public async syncLatestBlocks(network: Network, blockCount: number = 100): Promise<void> {
        try {
            if (!this.rpcClient) {
                throw new BlockProcessorError('RPC client not initialized');
            }
            
            // Mevcut blockchain yüksekliğini al
            const latestBlockInfo = await this.rpcClient.getLatestBlock();
            const currentHeight = parseInt(latestBlockInfo.block.header.height);
            
            // Senkronize edilecek başlangıç yüksekliğini hesapla
            const fromHeight = Math.max(1, currentHeight - blockCount + 1);
            
            // Tarihsel senkronizasyon metodunu çağır
            await this.syncHistoricalBlocks(network, fromHeight, currentHeight);
            
        } catch (error) {
            logger.error(`[BlockHandler] Error syncing latest blocks: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error) {
                logger.debug(`[BlockHandler] Error stack: ${error.stack}`);
            }
            throw error;
        }
    }
} 