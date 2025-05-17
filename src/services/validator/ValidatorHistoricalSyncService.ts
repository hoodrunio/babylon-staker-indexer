import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { ValidatorSignatureService } from './ValidatorSignatureService';
import { logger } from '../../utils/logger';

export class ValidatorHistoricalSyncService {
    private static instance: ValidatorHistoricalSyncService | null = null;
    private validatorSignatureService: ValidatorSignatureService;
    private babylonClient: BabylonClient;
    private network: Network;
    private syncInProgress: Map<Network, boolean> = new Map();
    private readonly MAX_HISTORICAL_BLOCKS = 10000;
    private readonly BATCH_SIZE = 100;

    private constructor() {
        this.validatorSignatureService = ValidatorSignatureService.getInstance();
        
        try {
            // Initialize BabylonClient using the network from environment variable
            this.babylonClient = BabylonClient.getInstance();
            this.network = this.babylonClient.getNetwork();
            logger.info(`[ValidatorHistoricalSyncService] Client initialized successfully for network: ${this.network}`);
        } catch (error) {
            logger.error('[ValidatorHistoricalSyncService] Failed to initialize BabylonClient:', error);
            throw new Error('[ValidatorHistoricalSyncService] Failed to initialize BabylonClient. Please check your NETWORK environment variable.');
        }
    }

    public static getInstance(): ValidatorHistoricalSyncService {
        if (!ValidatorHistoricalSyncService.instance) {
            ValidatorHistoricalSyncService.instance = new ValidatorHistoricalSyncService();
        }
        return ValidatorHistoricalSyncService.instance;
    }

    public async startSync(network: Network): Promise<void> {
        // Skip historical sync in non-production environment
        if (process.env.NODE_ENV !== 'production') {
            logger.info(`[ValidatorHistoricalSyncService] Skipping sync for ${network} in non-production environment`);
            return;
        }
        
        // Prevent multiple syncs for the same network
        if (this.syncInProgress.get(network)) {
            logger.info(`[ValidatorHistoricalSyncService] Sync already in progress for ${network}`);
            return;
        }

        try {
            this.syncInProgress.set(network, true);

            // Get current block height using our initialized client
            const currentHeight = await this.babylonClient.getCurrentHeight();
            
            // Get last processed block
            const lastProcessedBlock = await this.validatorSignatureService.getLastProcessedBlock(network);
            
            // Calculate sync range
            let startHeight = Math.max(
                lastProcessedBlock + 1,
                currentHeight - this.MAX_HISTORICAL_BLOCKS
            );

            logger.info(`[ValidatorHistoricalSyncService] Starting sync from block ${startHeight} to ${currentHeight} on ${network}`);

            // Process blocks in batches
            while (startHeight <= currentHeight) {
                const endHeight = Math.min(startHeight + this.BATCH_SIZE - 1, currentHeight);
                const batchPromises: Promise<void>[] = [];

                for (let height = startHeight; height <= endHeight; height++) {
                    batchPromises.push(this.processBlock(height, network));
                }

                try {
                    await Promise.all(batchPromises);
                    logger.info(`[ValidatorHistoricalSyncService] Processed blocks ${startHeight} to ${endHeight} on ${network}`);
                } catch (error) {
                    if (this.isPruningError(error)) {
                        logger.warn(`[ValidatorHistoricalSyncService] Detected pruned blocks at height ${startHeight}, skipping to latest available block`);
                        const availableBlock = await this.findEarliestAvailableBlock(startHeight, currentHeight);
                        if (availableBlock) {
                            startHeight = availableBlock;
                            continue;
                        } else {
                            logger.warn(`[ValidatorHistoricalSyncService] No available blocks found, stopping sync`);
                            break;
                        }
                    }
                    throw error;
                }

                startHeight = endHeight + 1;
            }

            logger.info(`[ValidatorHistoricalSyncService] Completed historical sync for ${network} up to block ${currentHeight}`);
        } catch (error) {
            logger.error(`[ValidatorHistoricalSyncService] Error during historical sync for ${network}:`, error);
        } finally {
            this.syncInProgress.set(network, false);
        }
    }

    private async processBlock(height: number, network: Network): Promise<void> {
        try {
            // Use our initialized BabylonClient
            const blockData = await this.babylonClient.getBlockByHeight(height);
            
            if (!blockData || !blockData.result || !blockData.result.block) {
                logger.warn(`[ValidatorHistoricalSyncService] No valid block data returned for height ${height}`);
                return;
            }
            
            const formattedBlock = {
                block: {
                    header: {
                        height: height.toString(),
                        time: blockData.result.block.header.time
                    },
                    last_commit: {
                        round: blockData.result.block.last_commit.round,
                        signatures: blockData.result.block.last_commit.signatures
                    }
                }
            };

            await this.validatorSignatureService.handleNewBlock(formattedBlock, network);
        } catch (error) {
            if (this.isPruningError(error)) {
                throw error;
            }
            logger.error(`[ValidatorHistoricalSyncService] Error processing block ${height}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

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
                    logger.error(`[ValidatorHistoricalSyncService] Unexpected error searching for available block: ${error instanceof Error ? error.message : String(error)}`);
                    return earliestAvailable; 
                }
            }
        }

        return earliestAvailable;
    }

    private isPruningError(error: any): boolean {
        return error?.response?.data?.error?.data?.includes('is not available, lowest height is') ||
               error?.message?.includes('is not available, lowest height is');
    }
} 