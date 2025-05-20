import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { logger } from '../../utils/logger';
import { EventContext } from './interfaces/IBCEventProcessor';
import { IBCBlockProcessor } from './block/IBCBlockProcessor';
import { IBCStateRepository } from './repository/IBCStateRepository';

/**
 * Main coordinator for IBC indexing
 * Follows Single Responsibility Principle by delegating specialized tasks to other services
 */
export class IBCIndexerService {
    private static instance: IBCIndexerService | null = null;
    private babylonClient: BabylonClient;
    private blockProcessor: IBCBlockProcessor;
    private stateRepository: IBCStateRepository;
    private network: Network;
    private syncInProgress: Map<Network, boolean> = new Map();
    private pollInterval: NodeJS.Timeout | null = null;
    private running: boolean = false;

    // Configuration constants
    private readonly MAX_HISTORICAL_BLOCKS = 10000;
    private readonly BATCH_SIZE = 100;
    private readonly DEFAULT_POLL_INTERVAL_MS = 5000;

    private constructor() {
        try {
            this.babylonClient = BabylonClient.getInstance();
            this.network = this.babylonClient.getNetwork();
            
            // Initialize dependencies (will be injected in a full implementation)
            this.blockProcessor = new IBCBlockProcessor(this.babylonClient);
            this.stateRepository = new IBCStateRepository();
            
            logger.info(`[IBCIndexerService] Initialized successfully for network: ${this.network}`);
        } catch (error) {
            logger.error('[IBCIndexerService] Failed to initialize:', error);
            throw new Error('[IBCIndexerService] Failed to initialize. Please check your NETWORK environment variable.');
        }
    }

    public static getInstance(): IBCIndexerService {
        if (!IBCIndexerService.instance) {
            IBCIndexerService.instance = new IBCIndexerService();
        }
        return IBCIndexerService.instance;
    }

    /**
     * Start the IBC indexer service
     */
    public async start(): Promise<void> {
        if (this.running) {
            logger.info('[IBCIndexerService] Already running');
            return;
        }
        
        this.running = true;
        logger.info('[IBCIndexerService] Starting service');

        // Start with historical indexing if specified in environment
        if (process.env.IBC_HISTORICAL_SYNC_ENABLED === 'true') {
            await this.startHistoricalSync(this.network);
        }
        
        // Then switch to polling mode for new blocks
        const pollIntervalMs = parseInt(process.env.IBC_POLL_INTERVAL_MS || this.DEFAULT_POLL_INTERVAL_MS.toString());
        this.pollInterval = setInterval(() => this.pollNewBlocks(this.network), pollIntervalMs);
        
        logger.info('[IBCIndexerService] Started successfully');
    }

    /**
     * Stop the IBC indexer service
     */
    public stop(): void {
        if (!this.running) return;
        
        logger.info('[IBCIndexerService] Stopping service');
        
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        
        this.running = false;
        logger.info('[IBCIndexerService] Stopped');
    }

    /**
     * Start historical synchronization for a specific network
     */
    public async startHistoricalSync(network: Network): Promise<void> {
        // Skip historical sync in non-production environment if specified
        if (process.env.NODE_ENV !== 'production' && process.env.FORCE_HISTORICAL_SYNC !== 'true') {
            logger.info(`[IBCIndexerService] Skipping historical sync for ${network} in non-production environment`);
            return;
        }
        
        // Prevent multiple syncs for the same network
        if (this.syncInProgress.get(network)) {
            logger.info(`[IBCIndexerService] Historical sync already in progress for ${network}`);
            return;
        }

        try {
            this.syncInProgress.set(network, true);

            // Get current block height
            const currentHeight = await this.babylonClient.getCurrentHeight();
            
            // Get last processed block
            const lastProcessedBlock = await this.stateRepository.getLastProcessedBlock(network);
            
            // Calculate sync range - start from the last processed block or go back a certain number of blocks
            let startHeight = Math.max(
                lastProcessedBlock + 1,
                currentHeight - this.MAX_HISTORICAL_BLOCKS
            );

            // Override starting height if specified in environment
            if (process.env.IBC_SYNC_FROM_HEIGHT) {
                const envStartHeight = parseInt(process.env.IBC_SYNC_FROM_HEIGHT);
                if (!isNaN(envStartHeight)) {
                    startHeight = envStartHeight;
                }
            }

            logger.info(`[IBCIndexerService] Starting historical sync from block ${startHeight} to ${currentHeight} on ${network}`);

            // Process blocks in batches
            while (startHeight <= currentHeight) {
                const endHeight = Math.min(startHeight + this.BATCH_SIZE - 1, currentHeight);
                const batchPromises: Promise<void>[] = [];

                for (let height = startHeight; height <= endHeight; height++) {
                    // Delegate block processing to specialized processor
                    batchPromises.push(this.processBlockAtHeight(height, network));
                }

                try {
                    await Promise.all(batchPromises);
                    logger.info(`[IBCIndexerService] Processed blocks ${startHeight} to ${endHeight} on ${network}`);
                } catch (error) {
                    if (this.isPruningError(error)) {
                        logger.warn(`[IBCIndexerService] Detected pruned blocks at height ${startHeight}, skipping to latest available block`);
                        const availableBlock = await this.findEarliestAvailableBlock(startHeight, currentHeight);
                        if (availableBlock) {
                            startHeight = availableBlock;
                            continue;
                        } else {
                            logger.warn(`[IBCIndexerService] No available blocks found, stopping sync`);
                            break;
                        }
                    }
                    throw error;
                }

                // Update last processed block in database
                await this.stateRepository.updateLastProcessedBlock(endHeight, network);

                startHeight = endHeight + 1;
            }

            logger.info(`[IBCIndexerService] Completed historical sync for ${network} up to block ${currentHeight}`);
        } catch (error) {
            logger.error(`[IBCIndexerService] Error during historical sync for ${network}:`, error);
        } finally {
            this.syncInProgress.set(network, false);
        }
    }

    /**
     * Poll for new blocks and process IBC related transactions
     */
    private async pollNewBlocks(network: Network): Promise<void> {
        try {
            // Skip if historical sync is in progress
            if (this.syncInProgress.get(network)) {
                return;
            }

            // Get last processed block height from database
            const lastProcessedHeight = await this.stateRepository.getLastProcessedBlock(network);
            
            // Get current blockchain height
            const currentHeight = await this.babylonClient.getCurrentHeight();
            
            // Process new blocks
            if (currentHeight > lastProcessedHeight) {
                logger.info(`[IBCIndexerService] Processing IBC data for blocks ${lastProcessedHeight + 1} to ${currentHeight} on ${network}`);
                
                for (let height = lastProcessedHeight + 1; height <= currentHeight; height++) {
                    await this.processBlockAtHeight(height, network);
                    
                    // Update last processed block
                    await this.stateRepository.updateLastProcessedBlock(height, network);
                }
            }
        } catch (error) {
            logger.error(`[IBCIndexerService] Error polling for new blocks: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Process a single block at given height
     * Delegates actual processing to specialized services
     */
    private async processBlockAtHeight(height: number, network: Network): Promise<void> {
        try {
            // Delegate to the block processor - following Single Responsibility Principle
            await this.blockProcessor.processBlock(height, network);
        } catch (error) {
            if (this.isPruningError(error)) {
                throw error;
            }
            logger.error(`[IBCIndexerService] Error processing block ${height}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Find the earliest available block after pruning
     */
    private async findEarliestAvailableBlock(start: number, end: number): Promise<number | null> {
        let left = start;
        let right = end;
        let earliestAvailable = null;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            try {
                // Use BabylonClient's getBlockByHeight method
                await this.babylonClient.getBlockByHeight(mid);
                earliestAvailable = mid;
                right = mid - 1;
            } catch (error) {
                if (this.isPruningError(error)) {
                    left = mid + 1;
                } else {
                    // If the error is not due to pruning, return the current mid value
                    logger.error(`[IBCIndexerService] Unexpected error searching for available block: ${error instanceof Error ? error.message : String(error)}`);
                    return earliestAvailable; 
                }
            }
        }

        return earliestAvailable;
    }

    /**
     * Check if an error is related to node pruning
     */
    private isPruningError(error: any): boolean {
        return error?.response?.data?.error?.data?.includes('is not available, lowest height is') ||
               error?.message?.includes('is not available, lowest height is');
    }
}
