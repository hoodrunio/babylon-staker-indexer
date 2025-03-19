/**
 * Block Processor Module
 * Main entry point for the block processing system
 */

import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { BlockProcessorInitializer } from './integration/BlockProcessorInitializer';
import { BlockTransactionHandler } from './handlers/BlockTransactionHandler';
import { IMessageProcessor } from '../websocket/interfaces';
import { FetcherService } from './common/fetcher.service';

/**
 * Main module for the block processing system
 * This class manages all components of the block processing system and communicates with the outside world
 */
export class BlockProcessorModule {
    private static instance: BlockProcessorModule | null = null;
    private initializer: BlockProcessorInitializer;
    private isInitialized: boolean = false;
    
    private constructor() {
        this.initializer = BlockProcessorInitializer.getInstance();
    }
    
    /**
     * Singleton instance
     */
    public static getInstance(): BlockProcessorModule {
        if (!BlockProcessorModule.instance) {
            BlockProcessorModule.instance = new BlockProcessorModule();
        }
        return BlockProcessorModule.instance;
    }
    
    /**
     * Initializes the module
     */
    public initialize(): void {
        if (this.isInitialized) {
            logger.info('[BlockProcessorModule] Module is already initialized');
            return;
        }
        
        try {
            logger.info('[BlockProcessorModule] Initializing Block Processor Module...');
            
            // Initialize the system using BlockProcessorInitializer
            this.initializer.initialize();
            this.isInitialized = true;
            
            logger.info('[BlockProcessorModule] Block Processor Module initialized successfully');
        } catch (error) {
            logger.error(`[BlockProcessorModule] Error initializing Block Processor Module: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Returns message processors for WebSocketMessageService
     */
    public getMessageProcessors(): IMessageProcessor[] {
        if (!this.isInitialized) {
            return this.getProcessorsWithoutInitializing();
        }
        
        return this.initializer.createMessageProcessors();
    }
    
    /**
     * Returns message processors without triggering full initialization.
     * This is used to break the circular dependency with WebSocketMessageService.
     */
    private getProcessorsWithoutInitializing(): IMessageProcessor[] {
        logger.debug('[BlockProcessorModule] Getting message processors without full initialization');
        return this.initializer.createMessageProcessors();
    }
    
    /**
     * Returns BlockTransactionHandler instance
     */
    public getBlockTransactionHandler(): BlockTransactionHandler {
        if (!this.isInitialized) {
            this.initialize();
        }
        
        const handler = this.initializer.getBlockTransactionHandler();
        if (!handler) {
            throw new Error('[BlockProcessorModule] BlockTransactionHandler is not initialized');
        }
        
        return handler;
    }
    
    /**
     * Returns FetcherService instance
     * Used to fetch transaction details from blockchain
     */
    public getFetcherService(): FetcherService {
        if (!this.isInitialized) {
            this.initialize();
        }
        
        const fetcherService = this.initializer.getFetcherService();
        if (!fetcherService) {
            throw new Error('[BlockProcessorModule] FetcherService is not initialized');
        }
        
        return fetcherService;
    }
    
    /**
     * Returns supported networks
     * @returns List of supported networks
     */
    public getSupportedNetworks(): Network[] {
        if (!this.isInitialized) {
            this.initialize();
        }
        
        const fetcherService = this.getFetcherService();
        return fetcherService.getSupportedNetworks();
    }
    
    /**
     * Synchronizes historical data for a specific network
     * @param network Network information (MAINNET, TESTNET)
     * @param fromHeight Starting block height (optional)
     * @param blockCount Number of blocks to synchronize (optional)
     */
    public async startHistoricalSync(
        network: Network,
        fromHeight?: number,
        blockCount?: number
    ): Promise<void> {
        if (!this.isInitialized) {
            this.initialize();
        }
        
        await this.initializer.startHistoricalSync(network, fromHeight, blockCount);
    }
}