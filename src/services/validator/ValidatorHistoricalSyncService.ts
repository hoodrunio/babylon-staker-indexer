import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { ValidatorSignatureService } from './ValidatorSignatureService';
import axios from 'axios';
import { logger } from '../../utils/logger';

export class ValidatorHistoricalSyncService {
    private static instance: ValidatorHistoricalSyncService | null = null;
    private validatorSignatureService: ValidatorSignatureService;
    private syncInProgress: Map<Network, boolean> = new Map();
    private readonly MAX_HISTORICAL_BLOCKS = 10000;
    private readonly BATCH_SIZE = 100;
    private readonly isProd = process.env.NODE_ENV === 'production';

    private constructor() {
        this.validatorSignatureService = ValidatorSignatureService.getInstance();
    }

    public static getInstance(): ValidatorHistoricalSyncService {
        if (!ValidatorHistoricalSyncService.instance) {
            ValidatorHistoricalSyncService.instance = new ValidatorHistoricalSyncService();
        }
        return ValidatorHistoricalSyncService.instance;
    }

    public async startSync(network: Network, client: BabylonClient): Promise<void> {
        // Prevent multiple syncs for the same network
        if (this.syncInProgress.get(network)) {
            logger.info(`[HistoricalSync] Sync already in progress for ${network}`);
            return;
        }

        try {
            this.syncInProgress.set(network, true);

            // Get current block height
            const response = await axios.get(`${client.getRpcUrl()}/status`);
            const currentHeight = parseInt(response.data.result.sync_info.latest_block_height);
            
            // Get last processed block
            const lastProcessedBlock = await this.validatorSignatureService.getLastProcessedBlock(network);
            
            // Calculate sync range
            let startHeight = Math.max(
                lastProcessedBlock + 1,
                this.isProd === true ? currentHeight - this.MAX_HISTORICAL_BLOCKS : currentHeight - 100
            );

            logger.info(`[HistoricalSync] Starting sync from block ${startHeight} to ${currentHeight} on ${network}`);

            // Process blocks in batches
            while (startHeight <= currentHeight) {
                const endHeight = Math.min(startHeight + this.BATCH_SIZE - 1, currentHeight);
                const batchPromises: Promise<void>[] = [];

                for (let height = startHeight; height <= endHeight; height++) {
                    batchPromises.push(this.processBlock(height, network, client));
                }

                try {
                    await Promise.all(batchPromises);
                    logger.info(`[HistoricalSync] Processed blocks ${startHeight} to ${endHeight} on ${network}`);
                } catch (error) {
                    if (this.isPruningError(error)) {
                        logger.warn(`[HistoricalSync] Detected pruned blocks at height ${startHeight}, skipping to latest available block`);
                        const availableBlock = await this.findEarliestAvailableBlock(startHeight, currentHeight, client);
                        if (availableBlock) {
                            startHeight = availableBlock;
                            continue;
                        } else {
                            logger.warn(`[HistoricalSync] No available blocks found, stopping sync`);
                            break;
                        }
                    }
                    throw error;
                }

                startHeight = endHeight + 1;
            }

            logger.info(`[HistoricalSync] Completed for ${network}`);
        } catch (error) {
            logger.error(`[HistoricalSync] Error during sync for ${network}:`, error);
            throw error;
        } finally {
            this.syncInProgress.set(network, false);
        }
    }

    private async processBlock(height: number, network: Network, client: BabylonClient): Promise<void> {
        try {
            const response = await axios.get(`${client.getRpcUrl()}/block?height=${height}`);
            const blockData = {
                block: {
                    header: {
                        height: height.toString(),
                        time: response.data.result.block.header.time
                    },
                    last_commit: {
                        round: response.data.result.block.last_commit.round,
                        signatures: response.data.result.block.last_commit.signatures
                    }
                }
            };

            await this.validatorSignatureService.handleNewBlock(blockData, network);
        } catch (error) {
            if (this.isPruningError(error)) {
                throw error;
            }
            logger.error(`[HistoricalSync] Error processing block ${height}:`, error);
        }
    }

    private async findEarliestAvailableBlock(start: number, end: number, client: BabylonClient): Promise<number | null> {
        let left = start;
        let right = end;
        let earliestAvailable = null;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            try {
                await axios.get(`${client.getRpcUrl()}/block?height=${mid}`);
                earliestAvailable = mid;
                right = mid - 1;
            } catch (error) {
                if (this.isPruningError(error)) {
                    left = mid + 1;
                } else {
                    throw error;
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