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

            // Blok verilerini kontrol et
            if (!blockData) {
                throw new BlockProcessorError('Block data is null or undefined');
            }

            let block;
            
            if (blockData.block.header) {
                // WebsocketBlockEvent formatına uygun olarak veriyi hazırla
                const blockEvent = {
                    query: "tm.event='NewBlock'",
                    data: {
                        type: "tendermint/event/NewBlock",
                        value: {
                            block: blockData.block,
                            block_id: blockData.block.block_id || {},
                            result_finalize_block: blockData.result_finalize_block || {}
                        }
                    },
                    events: {}
                };
                block = await this.blockProcessor.processBlockFromWebsocket(blockEvent);
                //logger.debug(`[BlockHandler-Websocket] Processed block ${block.height} on ${network} with ${block.numTxs} transactions`);
            } else {
                // Common servisini kullanarak bloğu işle
                block = await this.blockProcessor.processBlock(blockData);
                // Bloğu veritabanına kaydet
                logger.debug(`[BlockHandler-Normal] Processed block ${block.height} on ${network} with ${block.numTxs} transactions`);
            }
            
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
            
            // Daha özet bir log kaydı
            //logger.debug(`[TxHandler] Processed tx ${tx.txHash.substring(0, 8)}... at height ${tx.height} on ${network}`);
            
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
            
            // latestBlockInfo kontrolü
            if (!latestBlockInfo || !latestBlockInfo.block || !latestBlockInfo.block.header) {
                throw new BlockProcessorError('Could not get latest block information from RPC client');
            }
            
            const currentHeight = parseInt(latestBlockInfo.block.header.height);
            
            // Hedef yüksekliği belirle
            const syncToHeight = toHeight ? Math.min(toHeight, currentHeight) : currentHeight;
            
            logger.info(`[BlockHandler] Syncing blocks from ${fromHeight} to ${syncToHeight} on ${network}...`);
            
            // Başarısız blokları takip et
            const failedBlocks: number[] = [];
            
            // Blocklari işle (burada basit bir senkron işlem yapıyoruz, paralel işleme eklenebilir)
            for (let height = fromHeight; height <= syncToHeight; height++) {
                try {
                    await this.syncBlockAtHeight(height, network);
                    
                    // Her 100 blokta bir logging
                    if (height % 100 === 0) {
                        logger.info(`[BlockHandler] Synced up to block ${height} (${Math.floor((height - fromHeight) * 100 / (syncToHeight - fromHeight + 1))}%)`);
                    }
                } catch (blockError) {
                    // Blok senkronizasyonu başarısız oldu, ancak devam et
                    failedBlocks.push(height);
                    logger.warn(`[BlockHandler] Failed to sync block ${height}, continuing with next block`);
                }
            }
            
            // Başarısız blokları raporla
            if (failedBlocks.length > 0) {
                logger.warn(`[BlockHandler] Failed to sync ${failedBlocks.length} blocks: ${failedBlocks.join(', ')}`);
            }
            
            logger.info(`[BlockHandler] Historical sync completed: ${syncToHeight - fromHeight + 1 - failedBlocks.length} blocks processed on ${network}`);
            
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
    private async syncBlockAtHeight(height: number, network: Network, retryCount: number = 0): Promise<void> {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000; // 2 saniye
        
        try {
            if (!this.blockProcessor || !this.txProcessor || !this.blockStorage || !this.txStorage) {
                throw new BlockProcessorError('Processors or storage not initialized');
            }
            
            // Bloğu al
            const blockData = await this.rpcClient.getBlockByHeight(height);
            
            // blockData kontrolü
            if (!blockData || !blockData.result || !blockData.result.block) {
                throw new BlockProcessorError(`Could not get block data for height ${height}`);
            }
            
            // Bloğu işle
            const block = await this.blockProcessor.processBlock(blockData.result.block);
            
            // Bloğu veritabanına kaydet
            await this.blockStorage.saveBlock(block, network);
            
            // İşlemleri al ve işle
            let processedTxCount = 0;
            let savedTxCount = 0;
            let errorTxCount = 0;
            
            // Blok yüksekliğindeki tüm işlemleri getTxSearch ile al
            try {
                const txSearchResult = await this.rpcClient.getTxSearch(height);
                
                // txSearchResult kontrolü - daha güvenli kontrol
                if (txSearchResult && txSearchResult.result && txSearchResult.result.txs && Array.isArray(txSearchResult.result.txs)) {
                    const totalTxCount = txSearchResult.result.txs.length;
                    logger.info(`[BlockHandler] Found ${totalTxCount} transactions for block ${height} on ${network}`);
                    
                    for (const txData of txSearchResult.result.txs) {
                        try {
                            // İşlemi işle
                            const tx = await this.txProcessor.processTx(txData);
                            processedTxCount++;
                            
                            // İşlemi veritabanına kaydet
                            await this.txStorage.saveTx(tx, network);
                            savedTxCount++;
                        } catch (txError) {
                            errorTxCount++;
                            logger.error(`[TxHandler] Error processing tx in block ${height}: ${txError instanceof Error ? txError.message : String(txError)}`);
                        }
                    }
                    
                    // Blok işleme özetini logla
                    logger.info(`[BlockHandler] Block ${height} on ${network}: Processed ${processedTxCount}/${totalTxCount} transactions, Saved ${savedTxCount}/${totalTxCount}, Errors ${errorTxCount}/${totalTxCount}`);
                } else {
                    // Alternatif olarak blok verilerinden işlemleri kontrol et
                    if (blockData.result.block.data?.txs && blockData.result.block.data.txs.length > 0) {
                        logger.warn(`[BlockHandler] getTxSearch returned no results for block ${height}, but block contains ${blockData.result.block.data.txs.length} transactions. Falling back to getTxByHash.`);
                        
                        const totalTxCount = blockData.result.block.data.txs.length;
                        
                        for (const encodedTx of blockData.result.block.data.txs) {
                            try {
                                // İşlem detayını al
                                const txDetail = await this.rpcClient.getTxByHash(encodedTx);
                                
                                // txDetail kontrolü
                                if (!txDetail) {
                                    logger.warn(`[TxHandler] Could not get transaction details for hash ${encodedTx}`);
                                    errorTxCount++;
                                    continue;
                                }
                                
                                // İşlemi işle
                                const tx = await this.txProcessor.processTx(txDetail);
                                processedTxCount++;
                                
                                // İşlemi veritabanına kaydet
                                await this.txStorage.saveTx(tx, network);
                                savedTxCount++;
                            } catch (txError) {
                                errorTxCount++;
                                logger.error(`[TxHandler] Error processing tx in block ${height}: ${txError instanceof Error ? txError.message : String(txError)}`);
                            }
                        }
                        
                        // Blok işleme özetini logla
                        logger.info(`[BlockHandler] Block ${height} on ${network} (fallback): Processed ${processedTxCount}/${totalTxCount} transactions, Saved ${savedTxCount}/${totalTxCount}, Errors ${errorTxCount}/${totalTxCount}`);
                    } else {
                        logger.info(`[BlockHandler] Block ${height} on ${network}: No transactions`);
                    }
                }
            } catch (txSearchError) {
                logger.error(`[BlockHandler] Error getting transactions for block ${height}: ${txSearchError instanceof Error ? txSearchError.message : String(txSearchError)}`);
                
                // getTxSearch başarısız olursa, blok verilerinden işlemleri al
                if (blockData.result.block.data?.txs && blockData.result.block.data.txs.length > 0) {
                    logger.warn(`[BlockHandler] Falling back to getTxByHash for block ${height} due to getTxSearch error`);
                    
                    const totalTxCount = blockData.result.block.data.txs.length;
                    
                    for (const encodedTx of blockData.result.block.data.txs) {
                        try {
                            // İşlem detayını al
                            const txDetail = await this.rpcClient.getTxByHash(encodedTx);
                            
                            // txDetail kontrolü
                            if (!txDetail) {
                                logger.warn(`[TxHandler] Could not get transaction details for hash ${encodedTx}`);
                                errorTxCount++;
                                continue;
                            }
                            
                            // İşlemi işle
                            const tx = await this.txProcessor.processTx(txDetail);
                            processedTxCount++;
                            
                            // İşlemi veritabanına kaydet
                            await this.txStorage.saveTx(tx, network);
                            savedTxCount++;
                        } catch (txError) {
                            errorTxCount++;
                            logger.error(`[TxHandler] Error processing tx in block ${height}: ${txError instanceof Error ? txError.message : String(txError)}`);
                        }
                    }
                    
                    // Blok işleme özetini logla
                    logger.info(`[BlockHandler] Block ${height} on ${network} (fallback): Processed ${processedTxCount}/${totalTxCount} transactions, Saved ${savedTxCount}/${totalTxCount}, Errors ${errorTxCount}/${totalTxCount}`);
                } else {
                    logger.info(`[BlockHandler] Block ${height} on ${network}: No transactions`);
                }
            }
            
        } catch (error) {
            logger.error(`[BlockHandler] Error syncing block at height ${height}: ${error instanceof Error ? error.message : String(error)}`);
            
            // Yeniden deneme mantığı
            if (retryCount < MAX_RETRIES) {
                logger.info(`[BlockHandler] Retrying sync for block ${height} (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
                
                // Yeniden denemeden önce bekle
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                
                // Yeniden dene
                return this.syncBlockAtHeight(height, network, retryCount + 1);
            }
            
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
            
            // latestBlockInfo kontrolü
            if (!latestBlockInfo || !latestBlockInfo.block || !latestBlockInfo.block.header) {
                throw new BlockProcessorError('Could not get latest block information from RPC client');
            }
            
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