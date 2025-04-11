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
import { BlockProcessorError } from './types/common';
import { LiteStorageConfig } from './types/common';
import { TxService } from './transaction/service/TxService';

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
            
            // Configure transaction service's lite storage if enabled
            this.configureTxLiteStorage();
            
            logger.info('[BlockProcessorModule] Block Processor Module initialized successfully');
        } catch (error) {
            logger.error(`[BlockProcessorModule] Error initializing Block Processor Module: ${this.formatError(error)}`);
            throw new BlockProcessorError(`Failed to initialize BlockProcessorModule: ${this.formatError(error)}`);
        }
    }
    
    /**
     * Configures TxService's lite storage based on environment variables
     */
    private configureTxLiteStorage(): void {
        const txService = TxService.getInstance();
        
        // Check if lite storage is enabled
        const isEnabled = process.env.TX_LITE_STORAGE_ENABLED === 'true';
        
        if (isEnabled) {
            logger.info('[BlockProcessorModule] Configuring TxService lite storage...');
            
            // Read configuration from environment variables or use defaults
            const maxFullInstances = parseInt(process.env.TX_LITE_MAX_FULL_INSTANCES || '5');
            const retentionHours = parseInt(process.env.TX_LITE_RETENTION_HOURS || '24');
            
            const config: LiteStorageConfig = {
                maxStoredFullInstances: maxFullInstances,
                fullContentRetentionHours: retentionHours
            };
            
            // Update TxService configuration
            txService.updateLiteStorageConfig(config);
            
            logger.info(`[BlockProcessorModule] TxService lite storage configured: maxInstances=${maxFullInstances}, retentionHours=${retentionHours}`);
        } else {
            logger.info('[BlockProcessorModule] TxService lite storage is disabled');
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

    /**
     * Formats the error message for logging
     * @param error The error object
     * @returns Formatted error message
     */
    private formatError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        } else if (typeof error === 'string') {
            return error;
        } else {
            return 'An unknown error occurred';
        }
    }
}