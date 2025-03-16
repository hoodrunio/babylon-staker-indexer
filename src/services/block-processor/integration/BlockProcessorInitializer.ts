/**
 * Block Processor Initialization Service
 * Service that initializes and manages the block processing system
 */

import { BlockProcessorService } from '../common/blockProcessor.service';
import { TransactionProcessorService } from '../common/transactionProcessor.service';
import { BlockTransactionHandler } from '../handlers/BlockTransactionHandler';
import { BlockStorage } from '../storage/BlockStorage';
import { TxStorage } from '../storage/TxStorage';
import { logger } from '../../../utils/logger';
import { BabylonClient } from '../../../clients/BabylonClient';
import { Network } from '../../../types/finality';
import { createBlockTxProcessors } from '../handlers/messageProcessors';
import { IMessageProcessor } from '../../websocket/interfaces';
import { HistoricalSyncService } from '../sync/historicalSync.service';
import { FetcherService } from '../common/fetcher.service';

/**
 * Class that initializes and manages the BlockProcessor system
 */
export class BlockProcessorInitializer {
    private static instance: BlockProcessorInitializer | null = null;
    private blockTransactionHandler: BlockTransactionHandler | null = null;
    private blockStorage: BlockStorage | null = null;
    private txStorage: TxStorage | null = null;
    private blockProcessor: BlockProcessorService | null = null;
    private txProcessor: TransactionProcessorService | null = null;
    private rpcClient: BabylonClient | null = null;
    private historicalSyncService: HistoricalSyncService | null = null;
    private fetcherService: FetcherService | null = null;
    private defaultNetwork: Network = Network.TESTNET;
    
    private constructor() {
        // Private constructor
    }
    
    /**
     * Singleton instance
     */
    public static getInstance(): BlockProcessorInitializer {
        if (!BlockProcessorInitializer.instance) {
            BlockProcessorInitializer.instance = new BlockProcessorInitializer();
        }
        return BlockProcessorInitializer.instance;
    }
    
    /**
     * Initializes the BlockProcessor system
     * @returns Initialized BlockTransactionHandler
     */
    public initialize(): BlockTransactionHandler {
        try {
            logger.info('[BlockProcessorInitializer] Initializing Block Processor system...');
            
            // Storage classes
            this.blockStorage = BlockStorage.getInstance();
            this.txStorage = TxStorage.getInstance();
            
            // Get RPC client
            this.rpcClient = BabylonClient.getInstance();
            
            // Get FetcherService
            this.fetcherService = FetcherService.getInstance();
            
            // Create processor services
            this.blockProcessor = new BlockProcessorService(this.blockStorage, this.defaultNetwork);
            
            // Get transaction details using FetcherService
            const fetchTxDetails = async (txHash: string, network?: Network) => {
                // Determine the network to use
                const targetNetwork = network || this.defaultNetwork;
                return this.fetcherService?.fetchTxDetails(txHash, targetNetwork) || null;
            };
            
            this.txProcessor = new TransactionProcessorService(this.txStorage, fetchTxDetails, this.defaultNetwork);
            
            // Initialize BlockTransactionHandler
            this.blockTransactionHandler = BlockTransactionHandler.getInstance();
            this.blockTransactionHandler.initialize(
                this.blockStorage,
                this.txStorage,
                this.blockProcessor,
                this.txProcessor,
                this.rpcClient
            );
            
            // Get HistoricalSyncService
            this.historicalSyncService = HistoricalSyncService.getInstance();
            
            logger.info('[BlockProcessorInitializer] Block Processor system initialized successfully');
            
            return this.blockTransactionHandler;
        } catch (error) {
            logger.error(`[BlockProcessorInitializer] Error initializing Block Processor system: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Creates message processors for WebSocketMessageService
     * @returns Array of message processors
     */
    public createMessageProcessors(): IMessageProcessor[] {
        if (!this.blockTransactionHandler) {
            this.initialize();
        }
        
        if (!this.blockTransactionHandler) {
            throw new Error('[BlockProcessorInitializer] BlockTransactionHandler is not initialized');
        }
        
        return createBlockTxProcessors(this.blockTransactionHandler);
    }
    
    /**
     * Synchronizes historical data for a specific network
     * @param network Network to synchronize
     * @param blockCount Number of blocks to synchronize (optional)
     */
    public async startHistoricalSync(
        network: Network,
        fromHeight?: number,
        blockCount?: number
    ): Promise<void> {
        try {
            if (!this.blockTransactionHandler) {
                this.initialize();
            }
            
            // Update network value of processors
            if (this.blockProcessor) {
                this.blockProcessor.setNetwork(network);
            }
            
            if (this.txProcessor) {
                this.txProcessor.setNetwork(network);
            }
            
            logger.info(`[BlockProcessorInitializer] Starting historical sync for ${network}...`);
            
            // Perform synchronization using HistoricalSyncService
            if (!this.historicalSyncService) {
                this.historicalSyncService = HistoricalSyncService.getInstance();
            }
            
            // Call startSync method of HistoricalSyncService
            await this.historicalSyncService.startSync(network, fromHeight, blockCount);
            
            logger.info(`[BlockProcessorInitializer] Historical sync completed for ${network}`);
        } catch (error) {
            logger.error(`[BlockProcessorInitializer] Error during historical sync: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Returns BlockTransactionHandler instance
     * @returns BlockTransactionHandler instance
     */
    public getBlockTransactionHandler(): BlockTransactionHandler | null {
        return this.blockTransactionHandler;
    }
    
    /**
     * Returns FetcherService instance
     */
    public getFetcherService(): FetcherService | null {
        if (!this.fetcherService) {
            this.fetcherService = FetcherService.getInstance();
        }
        return this.fetcherService;
    }
    
    /**
     * Sets default network value
     */
    public setDefaultNetwork(network: Network): void {
        this.defaultNetwork = network;
    }
} 