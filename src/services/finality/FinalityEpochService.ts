import { BabylonClient } from '../../clients/BabylonClient';
import { EpochInfo, EpochStats, SignatureStatsParams } from '../../types';
import { FinalityProviderService } from './FinalityProviderService';
import { logger } from '../../utils/logger';

export class FinalityEpochService {
    private static instance: FinalityEpochService | null = null;
    private babylonClient: BabylonClient;
    private finalityProviderService: FinalityProviderService;
    private currentEpochInfo: { epochNumber: number; boundary: number } | null = null;
    private epochCache: Map<number, EpochInfo> = new Map();
    private currentEpochStatsCache: {
        stats: EpochStats;
        timestamp: number;
    } | null = null;
    
    private readonly EPOCHS_TO_KEEP = 14; // Keep last 14 epochs
    private readonly statsUpdateLock: Set<string> = new Set();
    private readonly STATS_UPDATE_INTERVAL = 60000; // 1 minute

    private constructor() {
        this.babylonClient = BabylonClient.getInstance();
        this.finalityProviderService = FinalityProviderService.getInstance();
        logger.info(`[FinalityEpochService] Initialized`);
    }


    


    public static getInstance(): FinalityEpochService {
        if (!FinalityEpochService.instance) {
            FinalityEpochService.instance = new FinalityEpochService();
        }
        return FinalityEpochService.instance;
    }

    public async getCurrentEpochInfo(): Promise<{ epochNumber: number; boundary: number }> {
        if (this.currentEpochInfo) {
            return this.currentEpochInfo;
        }
        
        const response = await this.babylonClient.getCurrentEpoch();
        this.currentEpochInfo = {
            epochNumber: Number(response.current_epoch),
            boundary: Number(response.epoch_boundary)
        };

        return this.currentEpochInfo;
    }

    public async checkAndUpdateEpoch(currentHeight: number): Promise<void> {
        try {
            // If cache doesn't exist or current height has passed the boundary
            if (!this.currentEpochInfo || currentHeight > this.currentEpochInfo.boundary) {
                const response = await this.babylonClient.getCurrentEpoch();
                const newEpochInfo = {
                    epochNumber: Number(response.current_epoch),
                    boundary: Number(response.epoch_boundary)
                };

                // If we have moved to a new epoch
                if (!this.currentEpochInfo || newEpochInfo.epochNumber > this.currentEpochInfo.epochNumber) {
                    this.currentEpochInfo = newEpochInfo;
                    await this.cleanupOldEpochs();
                    logger.info(`[FinalityEpochService] Moved to new epoch ${newEpochInfo.epochNumber} with boundary ${newEpochInfo.boundary}`);
                }
            }
        } catch (error) {
            logger.error(`[FinalityEpochService] Error updating epoch info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async cleanupOldEpochs(): Promise<void> {
        if (!this.currentEpochInfo) return;

        const currentEpoch = this.currentEpochInfo.epochNumber;
        const oldestEpochToKeep = currentEpoch - this.EPOCHS_TO_KEEP;

        // Get all heights from cache
        const heights = Array.from(this.epochCache.keys());

        // Remove entries for epochs older than oldestEpochToKeep
        for (const height of heights) {
            const epochInfo = this.epochCache.get(height);
            if (epochInfo && epochInfo.epochNumber < oldestEpochToKeep) {
                this.epochCache.delete(height);
            }
        }

        logger.debug(`[EpochService] Cleaned up epochs older than ${oldestEpochToKeep}, current cache size: ${this.epochCache.size}`);
    }

    public async calculateEpochForHeight(height: number): Promise<EpochInfo> {
        // Check cache first
        const cachedEpoch = this.epochCache.get(height);
        if (cachedEpoch) {
            return cachedEpoch;
        }

        const epochInfo = await this.getCurrentEpochInfo();
        const epochNumber = Math.floor(height / epochInfo.boundary);
        
        const epochData = {
            epochNumber,
            startHeight: epochNumber * epochInfo.boundary,
            endHeight: (epochNumber + 1) * epochInfo.boundary - 1
        };

        // Cache the result
        this.epochCache.set(height, epochData);
        
        return epochData;
    }

    public async updateCurrentEpochStats(
        getSignatureStats: (params: SignatureStatsParams) => Promise<any>
    ): Promise<EpochStats> {
        const lockKey = `epoch-stats`;
        
        // Check if stats are being updated
        if (this.statsUpdateLock.has(lockKey)) {
            if (this.currentEpochStatsCache) {
                return this.currentEpochStatsCache.stats;
            }
            throw new Error('Epoch stats are being updated');
        }

        // Check if cache is still valid
        if (this.currentEpochStatsCache && 
            Date.now() - this.currentEpochStatsCache.timestamp < this.STATS_UPDATE_INTERVAL) {
            return this.currentEpochStatsCache.stats;
        }

        try {
            this.statsUpdateLock.add(lockKey);
            
            const currentEpoch = await this.getCurrentEpochInfo();
            const currentHeight = await this.babylonClient.getCurrentHeight();
            const safeHeight = currentHeight - 2; // Process up to 2 blocks behind (because there is a timeout for the finality providers to submit their votes)
            
            // Calculate epoch boundaries
            const epochStartHeight = currentEpoch.boundary - 360; // Each epoch is 360 blocks
            const epochEndHeight = Math.min(currentEpoch.boundary);
            
            // Get active finality providers at current height
            const providers = await this.babylonClient.getActiveFinalityProvidersAtHeight(safeHeight);
            
            // Calculate stats for each provider
            const providerStats = await Promise.all(
                providers
                    .filter(provider => !provider.jailed && provider.highestVotedHeight > 0)
                    .map(async (provider) => {
                        const stats = await getSignatureStats({
                            fpBtcPkHex: provider.fpBtcPkHex,
                            startHeight: epochStartHeight,
                            endHeight: epochEndHeight
                        });
                        
                        const totalBlocks = stats.signedBlocks + stats.missedBlocks;
                        return {
                            btcPk: provider.fpBtcPkHex,
                            signedBlocks: stats.signedBlocks,
                            missedBlocks: stats.missedBlocks,
                            successRate: totalBlocks > 0 ? (stats.signedBlocks / totalBlocks * 100) : 0,
                            votingPower: provider.votingPower
                        };
                    })
            );

            // Sort providers by voting power in descending order
            providerStats.sort((a, b) => parseInt(b.votingPower) - parseInt(a.votingPower));

            // Create stats object
            const epochStats: EpochStats = {
                epochNumber: currentEpoch.epochNumber,
                startHeight: epochStartHeight,
                currentHeight: safeHeight,
                endHeight: epochEndHeight,
                providerStats,
                timestamp: Date.now()
            };

            // Save to cache
            this.currentEpochStatsCache = {
                stats: epochStats,
                timestamp: Date.now()
            };

            logger.debug(`[Stats] Updated epoch ${currentEpoch.epochNumber} stats with ${providerStats.length} providers`);
            
            return epochStats;
        } catch (error) {
            logger.error('Error updating current epoch stats:', error);
            throw error;
        } finally {
            this.statsUpdateLock.delete(lockKey);
        }
    }

    public async getCurrentEpochStats(): Promise<EpochStats> {
        if (!this.currentEpochStatsCache) {
            throw new Error('Epoch stats not initialized');
        }
        return this.currentEpochStatsCache.stats;
    }

    public async getProviderCurrentEpochStats(
        fpBtcPkHex: string, 
        getSignatureStats: (params: SignatureStatsParams) => Promise<any>
    ): Promise<{
        epochNumber: number;
        startHeight: number;
        currentHeight: number;
        endHeight: number;
        signedBlocks: number;
        missedBlocks: number;
        successRate: number;
        timestamp: number;
    }> {
        try {
            const currentEpoch = await this.getCurrentEpochInfo();
            const currentHeight = await this.babylonClient.getCurrentHeight();
            const epochStartHeight = currentEpoch.boundary - 360;
            const epochEndHeight = currentEpoch.boundary;

            const stats = await getSignatureStats({
                fpBtcPkHex,
                startHeight: epochStartHeight,
                endHeight: epochEndHeight
            });

            const totalBlocks = stats.signedBlocks + stats.missedBlocks;
            
            return {
                epochNumber: currentEpoch.epochNumber,
                startHeight: epochStartHeight,
                currentHeight,
                endHeight: epochEndHeight,
                signedBlocks: stats.signedBlocks,
                missedBlocks: stats.missedBlocks,
                successRate: totalBlocks > 0 ? (stats.signedBlocks / totalBlocks * 100) : 0,
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error(`[FinalityEpochService] Error getting current epoch stats for provider ${fpBtcPkHex}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
} 