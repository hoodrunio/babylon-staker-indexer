/**
 * Block and Transaction Handler Service
 * Service that processes block and tx events received via websocket and saves them to the database.
 */

import { BlockProcessorError, TxProcessorError } from '../types/common';
import { IBlockProcessorService, IBlockStorage, ITransactionProcessorService, ITxStorage } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { Network } from '../../../types/finality';

/**
 * Singleton class for Block and Transaction Handler
 */
export class BlockTransactionHandler {
    private static instance: BlockTransactionHandler | null = null;
    private blockStorage: IBlockStorage | null = null;
    private txStorage: ITxStorage | null = null;
    private blockProcessor: IBlockProcessorService | null = null;
    private txProcessor: ITransactionProcessorService | null = null;
    private rpcClient: any | null = null;

    /**
     * Creates or returns existing singleton instance
     */
    public static getInstance(): BlockTransactionHandler {
        if (!BlockTransactionHandler.instance) {
            BlockTransactionHandler.instance = new BlockTransactionHandler();
        }
        return BlockTransactionHandler.instance;
    }

    /**
     * Sets up required services
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
     * Called when a new block arrives and processes it
     */
    public async handleNewBlock(blockData: any, network: Network): Promise<void> {
        try {
            if (!this.blockProcessor || !this.blockStorage) {
                throw new BlockProcessorError('Block processor or storage not initialized');
            }

            // Check block data
            if (!blockData) {
                throw new BlockProcessorError('Block data is null or undefined');
            }

            let block;
            
            if (blockData.block.header) {
                // Prepare data according to WebsocketBlockEvent format
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
                // Process block using common service
                block = await this.blockProcessor.processBlock(blockData);
                // Save block to database
                logger.debug(`[BlockHandler-Normal] Processed block ${block.height} on ${network} with ${block.numTxs} transactions`);
            }
            
            // Additional post-processing can be done here
            // For example event subscribers, notifications to other services etc.
            
        } catch (error) {
            logger.error(`[BlockHandler] Error processing block: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error) {
                logger.debug(`[BlockHandler] Error stack: ${error.stack}`);
            }
        }
    }

    /**
     * Called when a new transaction arrives and processes it
     */
    public async handleNewTransaction(txData: any, network: Network): Promise<void> {
        try {
            if (!this.txProcessor || !this.txStorage) {
                throw new TxProcessorError('Transaction processor or storage not initialized');
            }
            
            // Extract required fields from TxResult
            const txResult = txData.TxResult;
            const txHash = txData.tx_hash || '';
            const height = txResult.height;
            
            // Process transaction using transaction processor
            const tx = await this.txProcessor.processTx({
                hash: txHash,
                height,
                tx: txResult.tx,
                tx_result: txResult.result
            });
            
            // Save transaction to database
            await this.txStorage.saveTx(tx, network);
            
            // More concise logging
            //logger.debug(`[TxHandler] Processed tx ${tx.txHash.substring(0, 8)}... at height ${tx.height} on ${network}`);
            
            // Additional actions for successful processing
            
        } catch (error) {
            logger.error(`[TxHandler] Error processing transaction: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error) {
                logger.debug(`[TxHandler] Error stack: ${error.stack}`);
            }
        }
    }

    /**
     * Synchronizes historical blocks
     */
    public async syncHistoricalBlocks(network: Network, fromHeight: number, toHeight?: number): Promise<void> {
        try {
            if (!this.rpcClient) {
                throw new BlockProcessorError('RPC client not initialized');
            }
            
            if (!this.blockProcessor) {
                throw new BlockProcessorError('Block processor not initialized');
            }
            
            // Get current blockchain height
            const latestBlockInfo = await this.rpcClient.getLatestBlock();
            
            // Check latestBlockInfo
            if (!latestBlockInfo || !latestBlockInfo.block || !latestBlockInfo.block.header) {
                throw new BlockProcessorError('Could not get latest block information from RPC client');
            }
            
            const currentHeight = parseInt(latestBlockInfo.block.header.height);
            
            // Determine target height
            const syncToHeight = toHeight ? Math.min(toHeight, currentHeight) : currentHeight;
            
            logger.info(`[BlockHandler] Syncing blocks from ${fromHeight} to ${syncToHeight} on ${network}...`);
            
            // Track failed blocks
            const failedBlocks: number[] = [];
            
            // Process blocks (simple synchronous processing, parallel processing could be added)
            for (let height = fromHeight; height <= syncToHeight; height++) {
                try {
                    await this.syncBlockAtHeight(height, network);
                    
                    // Log every 100 blocks
                    if (height % 100 === 0) {
                        logger.info(`[BlockHandler] Synced up to block ${height} (${Math.floor((height - fromHeight) * 100 / (syncToHeight - fromHeight + 1))}%)`);
                    }
                } catch (blockError) {
                    // Block synchronization failed, but continue
                    failedBlocks.push(height);
                    logger.warn(`[BlockHandler] Failed to sync block ${height}, continuing with next block`);
                }
            }
            
            // Report failed blocks
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
     * Synchronizes block and its transactions at a specific height
     */
    private async syncBlockAtHeight(height: number, network: Network, retryCount: number = 0): Promise<void> {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000; // 2 seconds
        
        try {
            if (!this.blockProcessor || !this.txProcessor || !this.blockStorage || !this.txStorage) {
                throw new BlockProcessorError('Processors or storage not initialized');
            }
            
            // Get block
            const blockData = await this.rpcClient.getBlockByHeight(height);
            
            // Check blockData
            if (!blockData || !blockData.result || !blockData.result.block) {
                throw new BlockProcessorError(`Could not get block data for height ${height}`);
            }
            
            // Get block results (for gas values)
            const blockResults = await this.rpcClient.getBlockResults(height);
            
            // Calculate and add gas values to blockData
            if (blockResults && blockResults.txs_results) {
                // Create result_finalize_block field
                blockData.result.block.result_finalize_block = {
                    tx_results: blockResults.txs_results.map((txResult: any) => {
                        // Transform gas values for each tx_result
                        return {
                            gas_wanted: txResult.gas_wanted || '0',
                            gas_used: txResult.gas_used || '0'
                        };
                    })
                };
                
                logger.debug(`[BlockHandler] Added gas values for block ${height} from block results`);
            }
            
            // Process block
            const block = await this.blockProcessor.processBlock(blockData.result.block);
            
            // Save block to database
            await this.blockStorage.saveBlock(block, network);
            
            // Get and process transactions
            let processedTxCount = 0;
            let savedTxCount = 0;
            let errorTxCount = 0;
            
            // Get all transactions at block height using getTxSearch
            try {
                const txSearchResult = await this.rpcClient.getTxSearch(height);
                
                // Check txSearchResult - safer check
                if (txSearchResult && txSearchResult.result && txSearchResult.result.txs && Array.isArray(txSearchResult.result.txs)) {
                    const totalTxCount = txSearchResult.result.txs.length;
                    logger.info(`[BlockHandler] Found ${totalTxCount} transactions for block ${height} on ${network}`);
                    
                    for (const txData of txSearchResult.result.txs) {
                        try {
                            // Process transaction
                            const tx = await this.txProcessor.processTx(txData);
                            processedTxCount++;
                            
                            // Save transaction to database
                            await this.txStorage.saveTx(tx, network);
                            savedTxCount++;
                        } catch (txError) {
                            errorTxCount++;
                            logger.error(`[TxHandler] Error processing tx in block ${height}: ${txError instanceof Error ? txError.message : String(txError)}`);
                        }
                    }
                    
                    // Log block processing summary
                    logger.info(`[BlockHandler] Block ${height} on ${network}: Processed ${processedTxCount}/${totalTxCount} transactions, Saved ${savedTxCount}/${totalTxCount}, Errors ${errorTxCount}/${totalTxCount}`);
                } else {
                    // Alternatively check transactions from block data
                    if (blockData.result.block.data?.txs && blockData.result.block.data.txs.length > 0) {
                        logger.warn(`[BlockHandler] getTxSearch returned no results for block ${height}, but block contains ${blockData.result.block.data.txs.length} transactions. Falling back to getTxByHash.`);
                        
                        const totalTxCount = blockData.result.block.data.txs.length;
                        
                        for (const encodedTx of blockData.result.block.data.txs) {
                            try {
                                // Get transaction details
                                const txDetail = await this.rpcClient.getTxByHash(encodedTx);
                                
                                // Check txDetail
                                if (!txDetail) {
                                    logger.warn(`[TxHandler] Could not get transaction details for hash ${encodedTx}`);
                                    errorTxCount++;
                                    continue;
                                }
                                
                                // Process transaction
                                const tx = await this.txProcessor.processTx(txDetail);
                                processedTxCount++;
                                
                                // Save transaction to database
                                await this.txStorage.saveTx(tx, network);
                                savedTxCount++;
                            } catch (txError) {
                                errorTxCount++;
                                logger.error(`[TxHandler] Error processing tx in block ${height}: ${txError instanceof Error ? txError.message : String(txError)}`);
                            }
                        }
                        
                        // Log block processing summary
                        logger.info(`[BlockHandler] Block ${height} on ${network} (fallback): Processed ${processedTxCount}/${totalTxCount} transactions, Saved ${savedTxCount}/${totalTxCount}, Errors ${errorTxCount}/${totalTxCount}`);
                    } else {
                        logger.info(`[BlockHandler] Block ${height} on ${network}: No transactions`);
                    }
                }
            } catch (txSearchError) {
                logger.error(`[BlockHandler] Error getting transactions for block ${height}: ${txSearchError instanceof Error ? txSearchError.message : String(txSearchError)}`);
                
                // If getTxSearch fails, get transactions from block data
                if (blockData.result.block.data?.txs && blockData.result.block.data.txs.length > 0) {
                    logger.warn(`[BlockHandler] Falling back to getTxByHash for block ${height} due to getTxSearch error`);
                    
                    const totalTxCount = blockData.result.block.data.txs.length;
                    
                    for (const encodedTx of blockData.result.block.data.txs) {
                        try {
                            // Get transaction details
                            const txDetail = await this.rpcClient.getTxByHash(encodedTx);
                            
                            // Check txDetail
                            if (!txDetail) {
                                logger.warn(`[TxHandler] Could not get transaction details for hash ${encodedTx}`);
                                errorTxCount++;
                                continue;
                            }
                            
                            // Process transaction
                            const tx = await this.txProcessor.processTx(txDetail);
                            processedTxCount++;
                            
                            // Save transaction to database
                            await this.txStorage.saveTx(tx, network);
                            savedTxCount++;
                        } catch (txError) {
                            errorTxCount++;
                            logger.error(`[TxHandler] Error processing tx in block ${height}: ${txError instanceof Error ? txError.message : String(txError)}`);
                        }
                    }
                    
                    // Log block processing summary
                    logger.info(`[BlockHandler] Block ${height} on ${network} (fallback): Processed ${processedTxCount}/${totalTxCount} transactions, Saved ${savedTxCount}/${totalTxCount}, Errors ${errorTxCount}/${totalTxCount}`);
                } else {
                    logger.info(`[BlockHandler] Block ${height} on ${network}: No transactions`);
                }
            }
            
        } catch (error) {
            logger.error(`[BlockHandler] Error syncing block at height ${height}: ${error instanceof Error ? error.message : String(error)}`);
            
            // Retry logic
            if (retryCount < MAX_RETRIES) {
                logger.info(`[BlockHandler] Retrying sync for block ${height} (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                
                // Retry
                return this.syncBlockAtHeight(height, network, retryCount + 1);
            }
            
            throw error;
        }
    }

    /**
     * Synchronizes latest blocks
     */
    public async syncLatestBlocks(network: Network, blockCount: number = 100): Promise<void> {
        try {
            if (!this.rpcClient) {
                throw new BlockProcessorError('RPC client not initialized');
            }
            
            // Get current blockchain height
            const latestBlockInfo = await this.rpcClient.getLatestBlock();
            
            // Check latestBlockInfo
            if (!latestBlockInfo || !latestBlockInfo.block || !latestBlockInfo.block.header) {
                throw new BlockProcessorError('Could not get latest block information from RPC client');
            }
            
            const currentHeight = parseInt(latestBlockInfo.block.header.height);
            
            // Calculate starting height for synchronization
            const fromHeight = Math.max(1, currentHeight - blockCount + 1);
            
            // Call historical synchronization method
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