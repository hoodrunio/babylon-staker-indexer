import { BabylonClient } from '../clients/BabylonClient';
import { logger } from '../utils/logger';
import { Block } from '../database/models/blockchain/Block';

interface BlockTimeData {
    height: number;
    timestamp: Date;
}

/**
 * Service to track block times and estimate when future blocks will be created
 */
export class BlockTimeService {
    private static instance: BlockTimeService | null = null;
    private readonly MAX_BLOCK_HISTORY = 100; // Use a larger window for better average calculation
    private recentBlocks: BlockTimeData[] = [];
    private averageBlockTime: number = 10000; // Default 10 seconds in milliseconds
    private lastUpdateTime: number = 0;
    private updateIntervalMs = 60000; // Update every minute
    private babylonClient: BabylonClient;
    
    private constructor() {
        this.babylonClient = BabylonClient.getInstance();
        this.startTracking();
    }
    
    public static getInstance(): BlockTimeService {
        if (!BlockTimeService.instance) {
            BlockTimeService.instance = new BlockTimeService();
        }
        return BlockTimeService.instance;
    }

    /**
     * Start tracking block times
     */
    private async startTracking(): Promise<void> {
        await this.updateBlockTimes();
        
        // Set up periodic updates
        setInterval(async () => {
            try {
                await this.updateBlockTimes();
            } catch (error) {
                logger.error(`[BlockTimeService] Error updating block times: ${error instanceof Error ? error.message : String(error)}`);
            }
        }, this.updateIntervalMs);
    }

    /**
     * Update the block time history from database
     */
    private async updateBlockTimes(): Promise<void> {
        const now = Date.now();
        
        // Limit update frequency
        if (now - this.lastUpdateTime < this.updateIntervalMs) {
            return;
        }
        
        this.lastUpdateTime = now;
        
        try {
            // Get recent blocks from database
            const blocks = await Block.find({})
                .sort({ height: -1 })
                .limit(this.MAX_BLOCK_HISTORY)
                .lean();
            
            if (blocks.length === 0) {
                logger.warn(`[BlockTimeService] No blocks found in database`);
                
                // Fall back to API if no blocks in database
                await this.updateBlockTimesFromAPI();
                return;
            }
            
            // Convert to BlockTimeData format
            this.recentBlocks = blocks.map((block: any) => ({
                height: parseInt(block.height),
                timestamp: new Date(block.time)
            })).sort((a, b) => a.height - b.height); // Sort by height ascending
            
            // Calculate average block time
            if (this.recentBlocks.length >= 2) {
                this.calculateAverageBlockTime();
            }
        } catch (error) {
            logger.error(`[BlockTimeService] Failed to update block times from database: ${error instanceof Error ? error.message : String(error)}`);
            
            // Fall back to API if database query fails
            await this.updateBlockTimesFromAPI();
        }
    }
    
    /**
     * Fall back to updating block times from API if database is not available
     */
    private async updateBlockTimesFromAPI(): Promise<void> {
        try {
            // Get current block
            const latestBlockData = await this.babylonClient.getLatestBlock();
            const currentHeight = parseInt(latestBlockData.block.header.height);
            
            // Get block data for the last MAX_BLOCK_HISTORY blocks
            const blockPromises = [];
            for (let i = 0; i < Math.min(this.MAX_BLOCK_HISTORY, currentHeight); i++) {
                const height = currentHeight - i;
                blockPromises.push(this.babylonClient.getBlockByHeight(height));
            }
            
            const blocks = await Promise.all(blockPromises);
            
            // Convert to BlockTimeData format
            this.recentBlocks = blocks
                .filter(block => block && block.result && block.result.block && block.result.block.header)
                .map(block => ({
                    height: parseInt(block.result.block.header.height),
                    timestamp: new Date(block.result.block.header.time)
                }))
                .sort((a, b) => a.height - b.height); // Sort by height ascending
            
            // Calculate average block time
            if (this.recentBlocks.length >= 2) {
                this.calculateAverageBlockTime();
            }
        } catch (error) {
            logger.error(`[BlockTimeService] Failed to update block times from API: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Calculate the average block time based on recent blocks
     */
    private calculateAverageBlockTime(): void {
        if (this.recentBlocks.length < 2) {
            return;
        }

        let totalTimeDiff = 0;
        let validTimeDiffs = 0;

        // Calculate time differences between consecutive blocks
        for (let i = 1; i < this.recentBlocks.length; i++) {
            const prevBlock = this.recentBlocks[i - 1];
            const currentBlock = this.recentBlocks[i];
            
            // Make sure blocks are in sequence
            if (currentBlock.height === prevBlock.height + 1) {
                const timeDiff = currentBlock.timestamp.getTime() - prevBlock.timestamp.getTime();
                
                // Ignore negative time differences or suspiciously large ones (> 30 seconds)
                if (timeDiff > 0 && timeDiff < 30000) {
                    totalTimeDiff += timeDiff;
                    validTimeDiffs++;
                }
            }
        }

        // Update average if we have valid time differences
        if (validTimeDiffs > 0) {
            this.averageBlockTime = totalTimeDiff / validTimeDiffs;
            logger.debug(`[BlockTimeService] Updated average block time to ${this.averageBlockTime}ms`);
        }
    }

    /**
     * Force an immediate update of block times
     */
    public async forceUpdate(): Promise<void> {
        await this.updateBlockTimes();
    }

    /**
     * Get the current average block time in milliseconds
     */
    public getAverageBlockTimeMs(): number {
        return this.averageBlockTime;
    }

    /**
     * Get the current average block time in seconds
     */
    public getAverageBlockTimeSeconds(): number {
        return this.averageBlockTime / 1000;
    }

    /**
     * Calculate estimated time until a future block will be created
     * @param targetHeight The target block height
     * @returns Estimated time in milliseconds until the block will be created, or null if the block already exists
     */
    public async getEstimatedTimeToBlock(targetHeight: number): Promise<{ 
        estimatedTimeMs: number | null;
        currentHeight: number;
        blockDifference: number;
        estimatedSeconds: number | null;
    }> {
        try {
            const currentHeight = await this.babylonClient.getCurrentHeight();
            
            // If the target block is in the past or is the current block
            if (targetHeight <= currentHeight) {
                return {
                    estimatedTimeMs: null,
                    currentHeight,
                    blockDifference: 0,
                    estimatedSeconds: null
                };
            }
            
            // Calculate how many blocks in the future
            const blockDifference = targetHeight - currentHeight;
            
            // Estimate time
            const estimatedTimeMs = blockDifference * this.averageBlockTime;
            
            return {
                estimatedTimeMs,
                currentHeight,
                blockDifference,
                estimatedSeconds: estimatedTimeMs / 1000
            };
        } catch (error) {
            logger.error(`[BlockTimeService] Error estimating time to block ${targetHeight}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
} 