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
    
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 2000; // 2 seconds

    private constructor() {
        // Private constructor to enforce singleton pattern
    }

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
            this.validateInitialization();
            
            // Check if network is configured
            if (!this.isNetworkConfigured(network)) {
                logger.warn(`[BlockHandler] Network ${network} is not configured, skipping block processing`);
                return;
            }
            
            this.validateBlockData(blockData);

            let block;
            
            if (blockData.block.header) {
                // Prepare data according to WebsocketBlockEvent format
                const blockEvent = this.createWebsocketBlockEvent(blockData);
                block = await this.blockProcessor!.processBlockFromWebsocket(blockEvent);
            } else {
                // Process block using common service
                block = await this.blockProcessor!.processBlock(blockData);
                // Log processing
                logger.debug(`[BlockHandler-Normal] Processed block ${block.height} on ${network} with ${block.numTxs} transactions`);
            }
            
            // Additional post-processing can be done here
            // For example event subscribers, notifications to other services etc.
            
        } catch (error) {
            this.logError('[BlockHandler] Error processing block', error);
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
            
        } catch (error) {
            this.logError('[TxHandler] Error processing transaction', error);
        }
    }

    /**
     * Synchronizes historical blocks
     */
    public async syncHistoricalBlocks(network: Network, fromHeight: number, toHeight?: number): Promise<void> {
        try {
            this.validateInitialization();
            
            // Get current blockchain height
            const currentHeight = await this.getCurrentBlockchainHeight();
            
            // Determine target height
            const syncToHeight = toHeight ? Math.min(toHeight, currentHeight) : currentHeight;
            
            logger.info(`[BlockHandler] Syncing blocks from ${fromHeight} to ${syncToHeight} on ${network}...`);
            
            // Track failed blocks
            const failedBlocks: number[] = [];
            
            // Process blocks
            for (let height = fromHeight; height <= syncToHeight; height++) {
                try {
                    await this.syncBlockAtHeight(height, network);
                    
                    // Log every 100 blocks
                    if (height % 100 === 0) {
                        const progressPercentage = Math.floor((height - fromHeight) * 100 / (syncToHeight - fromHeight + 1));
                        logger.info(`[BlockHandler] Synced up to block ${height} (${progressPercentage}%)`);
                    }
                } catch (blockError) {
                    // Block synchronization failed, but continue
                    failedBlocks.push(height);
                    logger.warn(`[BlockHandler] Failed to sync block ${height}, continuing with next block`);
                }
            }
            
            this.logSyncSummary(failedBlocks, fromHeight, syncToHeight, network);
            
        } catch (error) {
            this.logError('[BlockHandler] Error syncing historical blocks', error);
            throw error;
        }
    }
    
    /**
     * Synchronizes block and its transactions at a specific height
     */
    private async syncBlockAtHeight(height: number, network: Network, retryCount: number = 0): Promise<void> {
        try {
            this.validateInitialization();
            
            // Get block and process it
            const { blockData } = await this.fetchAndProcessBlock(height, network);
            
            // Process transactions
            await this.processBlockTransactions(height, blockData, network);
            
        } catch (error) {
            logger.error(`[BlockHandler] Error syncing block at height ${height}: ${error instanceof Error ? error.message : String(error)}`);
            
            // Retry logic
            if (retryCount < this.MAX_RETRIES) {
                logger.info(`[BlockHandler] Retrying sync for block ${height} (attempt ${retryCount + 1}/${this.MAX_RETRIES})...`);
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                
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
            this.validateInitialization();
            
            // Get current blockchain height
            const currentHeight = await this.getCurrentBlockchainHeight();
            
            // Calculate starting height for synchronization
            const fromHeight = Math.max(1, currentHeight - blockCount + 1);
            
            // Call historical synchronization method
            await this.syncHistoricalBlocks(network, fromHeight, currentHeight);
            
        } catch (error) {
            this.logError('[BlockHandler] Error syncing latest blocks', error);
            throw error;
        }
    }

    /**
     * Validates that all required services are initialized
     */
    private validateInitialization(): void {
        if (!this.blockProcessor || !this.txProcessor || !this.blockStorage || !this.txStorage || !this.rpcClient) {
            throw new BlockProcessorError('One or more required services not initialized');
        }
    }

    /**
     * Validates block data
     */
    private validateBlockData(blockData: any): void {
        if (!blockData) {
            throw new BlockProcessorError('Block data is null or undefined');
        }
    }

    /**
     * Creates a websocket block event from block data
     */
    private createWebsocketBlockEvent(blockData: any): any {
        return {
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
    }

    /**
     * Gets the current blockchain height
     */
    private async getCurrentBlockchainHeight(): Promise<number> {
        const latestBlockInfo = await this.rpcClient!.getLatestBlock();
        
        if (!latestBlockInfo || !latestBlockInfo.block || !latestBlockInfo.block.header) {
            throw new BlockProcessorError('Could not get latest block information from RPC client');
        }
        
        return parseInt(latestBlockInfo.block.header.height);
    }

    /**
     * Logs sync summary
     */
    private logSyncSummary(failedBlocks: number[], fromHeight: number, syncToHeight: number, network: Network): void {
        // Report failed blocks
        if (failedBlocks.length > 0) {
            logger.warn(`[BlockHandler] Failed to sync ${failedBlocks.length} blocks: ${failedBlocks.join(', ')}`);
        }
        
        const successfulBlocks = syncToHeight - fromHeight + 1 - failedBlocks.length;
        logger.info(`[BlockHandler] Historical sync completed: ${successfulBlocks} blocks processed on ${network}`);
    }

    /**
     * Fetches and processes a block at a specific height
     */
    private async fetchAndProcessBlock(height: number, network: Network): Promise<{ blockData: any }> {
        // Get block
        const blockData = await this.rpcClient!.getBlockByHeight(height);
        
        // Check blockData
        if (!blockData || !blockData.result || !blockData.result.block) {
            throw new BlockProcessorError(`Could not get block data for height ${height}`);
        }
        
        // Enrich block data with gas values
        await this.enrichBlockWithGasValues(blockData, height);
        
        // Process block
        await this.blockProcessor!.processBlock(blockData.result.block);
        
        // Save block to database
        //await this.blockStorage!.saveBlock(block, network);
        
        return { blockData};
    }

    /**
     * Enriches block data with gas values
     */
    private async enrichBlockWithGasValues(blockData: any, height: number): Promise<void> {
        // Get block results (for gas values)
        const blockResults = await this.rpcClient!.getBlockResults(height);
        
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
    }

    /**
     * Processes transactions for a block
     */
    private async processBlockTransactions(height: number, blockData: any, network: Network): Promise<void> {
        const processedTxCount = 0;
        const savedTxCount = 0;
        const errorTxCount = 0;
        
        try {
            // Try to get transactions using getTxSearch
            await this.processTransactionsWithTxSearch(height, network, processedTxCount, savedTxCount, errorTxCount);
        } catch (txSearchError) {
            logger.error(`[BlockHandler] Error getting transactions for block ${height}: ${txSearchError instanceof Error ? txSearchError.message : String(txSearchError)}`);
            
            // Fallback to processing transactions from block data
            await this.processTransactionsFromBlockData(height, blockData, network, processedTxCount, savedTxCount, errorTxCount);
        }
    }

    /**
     * Processes transactions using getTxSearch
     */
    private async processTransactionsWithTxSearch(
        height: number, 
        network: Network, 
        processedTxCount: number, 
        savedTxCount: number, 
        errorTxCount: number
    ): Promise<void> {
        const txSearchResult = await this.rpcClient!.getTxSearch(height);
        
        // Check txSearchResult
        if (txSearchResult && txSearchResult.result && txSearchResult.result.txs && Array.isArray(txSearchResult.result.txs)) {
            const totalTxCount = txSearchResult.result.txs.length;
            logger.info(`[BlockHandler] Found ${totalTxCount} transactions for block ${height} on ${network}`);
            
            const txResults = await this.processTxBatch(txSearchResult.result.txs, network);
            processedTxCount += txResults.processed;
            savedTxCount += txResults.saved;
            errorTxCount += txResults.errors;
            
            // Log block processing summary
            logger.info(`[BlockHandler] Block ${height} on ${network}: Processed ${processedTxCount}/${totalTxCount} transactions, Saved ${savedTxCount}/${totalTxCount}, Errors ${errorTxCount}/${totalTxCount}`);
        } else {
            logger.info(`[BlockHandler] Block ${height} on ${network}: No transactions found with getTxSearch`);
            throw new Error('No transactions found with getTxSearch');
        }
    }

    /**
     * Processes transactions from block data
     */
    private async processTransactionsFromBlockData(
        height: number, 
        blockData: any, 
        network: Network, 
        processedTxCount: number, 
        savedTxCount: number, 
        errorTxCount: number
    ): Promise<void> {
        if (blockData.result.block.data?.txs && blockData.result.block.data.txs.length > 0) {
            logger.warn(`[BlockHandler] Falling back to getTxByHash for block ${height}`);
            
            const totalTxCount = blockData.result.block.data.txs.length;
            const encodedTxs = blockData.result.block.data.txs;
            
            for (const encodedTx of encodedTxs) {
                try {
                    // Get transaction details
                    const txDetail = await this.rpcClient!.getTxByHash(encodedTx);
                    
                    // Check txDetail
                    if (!txDetail) {
                        logger.warn(`[TxHandler] Could not get transaction details for hash ${encodedTx}`);
                        errorTxCount++;
                        continue;
                    }
                    
                    // Process transaction
                    await this.txProcessor!.processTx(txDetail);
                    processedTxCount++;
                    
                    // Save transaction to database
                    //await this.txStorage!.saveTx(tx, network);
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

    /**
     * Processes a batch of transactions
     */
    private async processTxBatch(txs: any[], network: Network): Promise<{ processed: number, saved: number, errors: number }> {
        let processed = 0;
        let saved = 0;
        let errors = 0;
        
        for (const txData of txs) {
            try {
                // Process transaction
                await this.txProcessor!.processTx(txData);
                processed++;
                
                // Save transaction to database
                //await this.txStorage!.saveTx(tx, network);
                saved++;
            } catch (txError) {
                errors++;
                logger.error(`[TxHandler] Error processing tx: ${txError instanceof Error ? txError.message : String(txError)}`);
            }
        }
        
        return { processed, saved, errors };
    }

    /**
     * Logs an error with stack trace if available
     */
    private logError(prefix: string, error: unknown): void {
        logger.error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
            logger.debug(`${prefix} stack: ${error.stack}`);
        }
    }

    /**
     * Checks if a network is configured
     */
    private isNetworkConfigured(network: Network): boolean {
        try {
            if (!this.blockProcessor) {
                return false;
            }
            
            // Set network on block processor to ensure it's using the correct network
            this.blockProcessor.setNetwork(network);
            
            // Check if the network is supported by the processor
            return this.blockProcessor.isNetworkConfigured();
        } catch (error) {
            logger.error(`[BlockHandler] Error checking if network ${network} is configured: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
}