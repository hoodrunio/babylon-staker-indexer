import { logger } from '../../utils/logger';
import { WebSocketMessageService, BaseMessageProcessor } from '../websocket/WebSocketMessageService';
import { BabylonClient } from '../../clients/BabylonClient';
import { Network } from '../../types/finality';
import { IBCEventHandler } from './IBCEventHandler';
import { IBCMessageProcessor } from './IBCMessageProcessor';
import { IBCStateRepository } from './repository/IBCStateRepository';
import { IBCBlockProcessor } from './block/IBCBlockProcessor';

/**
 * Main module for the IBC indexer system
 * Integrates with the existing websocket architecture
 * Creates a self-contained module that can be initialized from the main application
 */
export class IBCModule {
    private static instance: IBCModule | null = null;
    private ibcEventHandler: IBCEventHandler;
    private ibcMessageProcessor: IBCMessageProcessor;
    private stateRepository: IBCStateRepository;
    private blockProcessor: IBCBlockProcessor;
    private babylonClient: BabylonClient;
    private initialized: boolean = false;
    private syncInProgress: boolean = false;

    private constructor() {
        // Initialize services
        this.babylonClient = BabylonClient.getInstance();
        this.ibcEventHandler = IBCEventHandler.getInstance();
        this.ibcMessageProcessor = new IBCMessageProcessor(this.ibcEventHandler);
        this.stateRepository = new IBCStateRepository();
        this.blockProcessor = new IBCBlockProcessor(this.babylonClient);
    }

    public static getInstance(): IBCModule {
        if (!IBCModule.instance) {
            IBCModule.instance = new IBCModule();
        }
        return IBCModule.instance;
    }

    /**
     * Initialize the IBC Module
     * Registers message processor with WebSocketMessageService
     */
    public initialize(): void {
        if (this.initialized) {
            logger.warn('[IBCModule] Already initialized');
            return;
        }

        logger.info('[IBCModule] Initializing IBC module');

        try {
            // Register IBC message processor to handle messages from existing subscriptions
            this.registerMessageProcessor();
            
            this.initialized = true;
            logger.info('[IBCModule] IBC module initialized successfully');
        } catch (error) {
            logger.error(`[IBCModule] Error initializing IBC module: ${error instanceof Error ? error.message : String(error)}`);
        }
    }



    /**
     * Register the IBC message processor
     * This allows the system to handle IBC-related events from the websocket
     * Will leverage the existing 'new_tx' subscription
     */
    private registerMessageProcessor(): void {
        try {
            // Get WebSocketMessageService instance
            const wsMessageService = WebSocketMessageService.getInstance();
            
            // Register the IBC message processor
            wsMessageService.registerMessageProcessor(this.ibcMessageProcessor);
            
            logger.info('[IBCModule] IBC message processor registered successfully');
        } catch (error) {
            logger.error(`[IBCModule] Error registering IBC message processor: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get the IBC message processor
     * This allows other systems to use our processor if needed
     */
    public getMessageProcessor(): BaseMessageProcessor {
        return this.ibcMessageProcessor;
    }

    /**
     * Get the state repository
     * This is used to query indexer state information
     */
    public getStateRepository(): IBCStateRepository {
        return this.stateRepository;
    }

    /**
     * Get the block processor
     * This allows external access to the block processor if needed
     */
    public getBlockProcessor(): IBCBlockProcessor {
        return this.blockProcessor;
    }

    /**
     * Start historical sync from a specific height
     * This will process all blocks from the given height to the current height
     * @param network Network to process
     * @param fromHeight Optional starting height (if not provided, will use last processed + 1)
     * @param blockCount Optional number of blocks to process (if fromHeight not specified)
     */
    public async startHistoricalSync(network: Network, fromHeight?: number, blockCount?: number): Promise<void> {
        if (this.syncInProgress) {
            logger.warn('[IBCModule] Historical sync already in progress');
            return;
        }
        
        this.syncInProgress = true;
        
        try {
            // If network is not specified, use the one from BabylonClient
            const targetNetwork = network || this.babylonClient.getNetwork();
            
            // Get current chain height
            const currentHeight = await this.babylonClient.getCurrentHeight();
            
            // Determine start height
            let startHeight: number;
            
            if (fromHeight !== undefined && fromHeight > 0) {
                startHeight = fromHeight;
            } else {
                // Get last processed block height
                const lastHeight = await this.stateRepository.getLastProcessedBlock(targetNetwork);
                startHeight = lastHeight + 1;
                
                // If blockCount is specified and no explicit fromHeight, use currentHeight - blockCount
                if (blockCount && !fromHeight && currentHeight > blockCount) {
                    startHeight = Math.max(startHeight, currentHeight - blockCount);
                }
            }
            
            logger.info(`[IBCModule] Starting historical sync for ${targetNetwork} from height ${startHeight} to ${currentHeight}`);
            
            // Process blocks sequentially
            for (let height = startHeight; height <= currentHeight; height++) {
                try {
                    await this.blockProcessor.processBlock(height, targetNetwork);
                    await this.stateRepository.updateLastProcessedBlock(height, targetNetwork);
                    
                    if (height % 100 === 0) {
                        logger.info(`[IBCModule] Historical sync progress: ${height}/${currentHeight} (${Math.round((height - startHeight) / (currentHeight - startHeight) * 100)}%)`);
                    }
                } catch (blockError) {
                    logger.error(`[IBCModule] Error processing block ${height}: ${blockError instanceof Error ? blockError.message : String(blockError)}`);
                    // Continue to next block
                }
            }
            
            logger.info(`[IBCModule] Historical sync completed. Processed from height ${startHeight} to ${currentHeight}`);
        } catch (error) {
            logger.error(`[IBCModule] Error during historical sync: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.syncInProgress = false;
        }
    }
}
