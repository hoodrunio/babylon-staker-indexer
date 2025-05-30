import { Response } from 'express';
import { BabylonClient } from '../../clients/BabylonClient';
import { FinalityCacheManager } from './FinalityCacheManager';
import { FinalityEpochService } from './FinalityEpochService';
import { FinalitySSEManager } from './FinalitySSEManager';
import { FinalitySignatureService } from './FinalitySignatureService';
import { 
    BlockSignatureInfo, 
    SignatureStats,
    SignatureStatsParams
} from '../../types';
import { logger } from '../../utils/logger';

export class FinalityBlockProcessor {
    private static instance: FinalityBlockProcessor | null = null;
    private lastProcessedHeight: number = 0;
    private readonly FINALIZATION_DELAY = 8000;
    private readonly MAX_RETRY_DELAY = 10000;
    private readonly MAX_RETRIES = 5;
    private readonly INITIAL_RETRY_DELAY = 2000;
    private readonly UPDATE_INTERVAL = 1000;
    private readonly FINALITY_ACTIVATION_HEIGHT: number;
    private babylonClient: BabylonClient;
    private cacheManager: FinalityCacheManager;
    private epochService: FinalityEpochService;
    private sseManager: FinalitySSEManager;
    private requestLocks: Map<string, boolean> = new Map();
    private processingBlocks: Set<number> = new Set();
    private updateInterval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private signatureService: FinalitySignatureService | null = null;

    private constructor() {
        this.babylonClient = BabylonClient.getInstance();
        this.cacheManager = FinalityCacheManager.getInstance();
        this.epochService = FinalityEpochService.getInstance();
        this.sseManager = FinalitySSEManager.getInstance();
        this.FINALITY_ACTIVATION_HEIGHT = parseInt(process.env.FINALITY_ACTIVATION_HEIGHT || '0', 10);
        logger.info(`[BlockProcessor] Finality activation height set to: ${this.FINALITY_ACTIVATION_HEIGHT}`);
    }

    public static getInstance(): FinalityBlockProcessor {
        if (!FinalityBlockProcessor.instance) {
            FinalityBlockProcessor.instance = new FinalityBlockProcessor();
        }
        return FinalityBlockProcessor.instance;
    }

    public async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('[BlockProcessor] Service is already running');
            return;
        }
        
        logger.info('[BlockProcessor] Starting block processor service...');
        this.isRunning = true;
        
        try {
            const currentHeight = await this.babylonClient.getCurrentHeight();
            
            if (currentHeight < this.FINALITY_ACTIVATION_HEIGHT) {
                logger.info(`[BlockProcessor] Current height (${currentHeight}) is below finality activation height (${this.FINALITY_ACTIVATION_HEIGHT}). Waiting for activation...`);
                
                // Don't start periodic updates yet, instead set up a check for activation
                this.scheduleActivationCheck();
            } else {
                // We are already past activation height, start periodic updates
                logger.info(`[BlockProcessor] Current height (${currentHeight}) is above finality activation height (${this.FINALITY_ACTIVATION_HEIGHT}). Starting normal processing.`);
                this.startPeriodicUpdate();
            }
        } catch (error) {
            logger.error('[BlockProcessor] Error checking current height:', error);
            // Start periodic updates anyway (fallback)
            this.startPeriodicUpdate();
        }
    }

    private scheduleActivationCheck(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        logger.info(`[BlockProcessor] Scheduled a check for finality activation height (${this.FINALITY_ACTIVATION_HEIGHT})`);
        
        // Check every 30 seconds instead of 1 second to reduce load
        this.updateInterval = setInterval(async () => {
            if (!this.isRunning) return;
            
            try {
                const currentHeight = await this.babylonClient.getCurrentHeight();
                
                if (currentHeight >= this.FINALITY_ACTIVATION_HEIGHT) {
                    logger.info(`[BlockProcessor] Finality activation height (${this.FINALITY_ACTIVATION_HEIGHT}) reached at height ${currentHeight}. Starting normal processing.`);
                    
                    // Clear this interval and start normal processing
                    if (this.updateInterval) {
                        clearInterval(this.updateInterval);
                        this.updateInterval = null;
                    }
                    this.lastProcessedHeight = this.FINALITY_ACTIVATION_HEIGHT - 1; // Start from activation height
                    this.startPeriodicUpdate();
                }
            } catch (error) {
                logger.error('[BlockProcessor] Error checking for activation height:', error);
            }
        }, 30000); // Check every 30 seconds
    }

    public stop(): void {
        logger.info('[BlockProcessor] Stopping block processor service...');
        this.isRunning = false;
        
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    private startPeriodicUpdate(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        this.updateInterval = setInterval(async () => {
            if (!this.isRunning) return;

            try {
                const currentHeight = await this.babylonClient.getCurrentHeight();
                
                // Process next block after last processed
                const nextHeight = this.lastProcessedHeight + 1;
                
                // Process if there's a new block and it's finalized
                if (nextHeight < currentHeight) {
                    await this.fetchAndCacheSignatures(nextHeight);
                }
            } catch (error) {
                logger.error('[BlockProcessor] Error in periodic update:', error);
            }
        }, this.UPDATE_INTERVAL);
    }

    public async initializeFromHeight(startHeight: number): Promise<void> {
        const currentHeight = await this.babylonClient.getCurrentHeight();
        this.lastProcessedHeight = startHeight - 1;
        logger.debug(`[BlockProcessor] Starting from: ${startHeight}`);
        
        // Process missing blocks
        const missingBlocks = [];
        for (let height = startHeight; height < currentHeight; height++) {
            if (!this.cacheManager.hasSignatureData(height)) {
                missingBlocks.push(height);
            }
        }

        if (missingBlocks.length > 0) {
            logger.debug(`[BlockProcessor] Processing ${missingBlocks.length} missing blocks`);
            
            // Batch size for parallel processing
            const BATCH_SIZE = 10;
            const batches = [];
            
            // Create batches of missing blocks
            for (let i = 0; i < missingBlocks.length; i += BATCH_SIZE) {
                batches.push(missingBlocks.slice(i, i + BATCH_SIZE));
            }

            // Process batches in parallel
            for (const batch of batches) {
                await Promise.all(
                    batch.map(height => this.fetchAndCacheSignatures(height))
                );
            }
        }
    }

    public async fetchAndCacheSignatures(height: number, retryCount = 0): Promise<void> {
        const requestKey = `${height}-${retryCount}`;
        
        // Skip if block is already processed and has sufficient signatures
        if (this.cacheManager.isProcessed(height) && this.cacheManager.hasSignatureData(height)) {
            return;
        }

        // Skip if request is already in progress
        if (this.requestLocks.has(requestKey)) {
            return;
        }

        // Skip if height is below activation height
        if (height < this.FINALITY_ACTIVATION_HEIGHT) {
            // Process block with empty signatures to avoid retrying
            await this.cacheManager.processBlock(height, new Set());
            return;
        }

        this.requestLocks.set(requestKey, true);
        this.processingBlocks.add(height);

        const retryDelay = Math.min(
            this.MAX_RETRY_DELAY,
            this.INITIAL_RETRY_DELAY * Math.pow(2, retryCount)
        );

        try {
            // Get current height to ensure we're not fetching too early
            const currentHeight = await this.babylonClient.getCurrentHeight();
            
            // Ensure we're at least 2 blocks behind the current height
            if (currentHeight <= height + 3) {
                logger.debug(`[Cache] Block ${height} is too recent, waiting for finalization (current: ${currentHeight})`);
                this.requestLocks.delete(requestKey);
                await new Promise(resolve => setTimeout(resolve, this.FINALIZATION_DELAY));
                return this.fetchAndCacheSignatures(height, retryCount);
            }

            const votes = await this.babylonClient.getVotesAtHeight(height);
            
            // Retry if no votes on first attempt and block is above activation height
            if (votes.length === 0 && retryCount < this.MAX_RETRIES && !this.cacheManager.hasSignatureData(height)) {
                this.requestLocks.delete(requestKey);
                
                // Only log the first retry attempt
                if (retryCount === 0) {
                    logger.debug(`[Cache] No votes found for block ${height}, will retry ${this.MAX_RETRIES} times`);
                }
                
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                return this.fetchAndCacheSignatures(height, retryCount + 1);
            }

            if (votes.length > 0) {
                const signers = new Set(votes.map(v => v.fp_btc_pk_hex.toLowerCase()));
                await this.cacheManager.processBlock(height, signers);
                
                // Only log if signatures were found
                logger.info(`[Cache] ✅ Block ${height} processed, signers: ${signers.size}, cache size: ${this.cacheManager.getCacheSize()}`);
                
                // Retry if new signatures found and max retries not reached
                if (retryCount < this.MAX_RETRIES) {
                    this.requestLocks.delete(requestKey);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    return this.fetchAndCacheSignatures(height, retryCount + 1);
                }
            } else if (!this.cacheManager.hasSignatureData(height)) {
                // Only log the final attempt failure
                if (retryCount === this.MAX_RETRIES - 1) {
                    logger.debug(`[Cache] No votes found for block ${height} after ${this.MAX_RETRIES} attempts`);
                }
            }
        } catch (error) {
            if (retryCount < this.MAX_RETRIES && !this.cacheManager.hasSignatureData(height)) {
                // Check if the error is related to future blocks (height not available)
                if (error instanceof Error && 
                    (error.name === 'HeightNotAvailableError' || 
                     error.message.includes('SPECIAL_ERROR_FUTURE_HEIGHT') ||
                     error.message.includes('height') && 
                     error.message.includes('must be less than or equal to the current blockchain height'))) {
                    
                    logger.info(`[Cache] Block ${height} is not available yet (future block), skipping retry`);
                    this.requestLocks.delete(requestKey);
                    this.processingBlocks.delete(height);
                    return;
                }
                
                this.requestLocks.delete(requestKey);
                
                // Only log the first retry error
                if (retryCount === 0) {
                    logger.warn(`[Cache] Error processing block ${height}, will retry ${this.MAX_RETRIES} times:`, error);
                }
                
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                return this.fetchAndCacheSignatures(height, retryCount + 1);
            }
            
            // Only log the final error
            if (retryCount === this.MAX_RETRIES - 1) {
                logger.error(`[Cache] ❌ Error processing block ${height} after ${this.MAX_RETRIES} attempts:`, error);
            }
        } finally {
            this.requestLocks.delete(requestKey);
            this.processingBlocks.delete(height);
        }
    }

    public async handleNewBlock(height: number): Promise<void> {
        try {
            // Process previous block (finalized)
            const previousHeight = height - 1;
            
            // Skip if block is already processed or below activation height
            if (previousHeight <= this.lastProcessedHeight || 
                this.cacheManager.isProcessed(previousHeight) || 
                previousHeight < this.FINALITY_ACTIVATION_HEIGHT) {
                return;
            }

            // Check and update epoch if needed
            await this.epochService.checkAndUpdateEpoch(height);

            // Check and process missing blocks
            const missingBlocks = [];
            for (let h = Math.max(this.lastProcessedHeight + 1, this.FINALITY_ACTIVATION_HEIGHT); h <= previousHeight; h++) {
                if (!this.cacheManager.isProcessed(h)) {
                    missingBlocks.push(h);
                }
            }

            if (missingBlocks.length > 0) {
                // Only log if there are more than 1 missing blocks or debug mode is enabled
                if (missingBlocks.length > 1) {
                    logger.info(`[BlockProcessor] Processing ${missingBlocks.length} missing blocks before ${previousHeight}`);
                }
                // Process blocks sequentially
                for (const blockHeight of missingBlocks) {
                    // Wait for block finalization
                    await new Promise(resolve => setTimeout(resolve, this.FINALIZATION_DELAY));
                    await this.fetchAndCacheSignatures(blockHeight);
                }
            }

            // Process last block
            await new Promise(resolve => setTimeout(resolve, this.FINALIZATION_DELAY));
            await this.fetchAndCacheSignatures(previousHeight);
            this.lastProcessedHeight = previousHeight;
            
            // Broadcast only last block to SSE clients
            await this.broadcastNewBlock(previousHeight);

            // Update epoch stats
            await this.epochService.updateCurrentEpochStats(
                (params) => this.getSignatureStats(params)
            );

            // Cleanup cache
            await this.cacheManager.cleanup();
        } catch (error) {
            logger.error('[BlockProcessor] Error processing new block:', error);
        }
    }

    private async broadcastNewBlock(height: number): Promise<void> {
        // Only broadcast blocks that are 2 blocks behind current height
        const currentHeight = await this.babylonClient.getCurrentHeight();
        if (height > currentHeight - 2) {
            return;
        }

        const signers = this.cacheManager.getSigners(height);
        const timestamp = this.cacheManager.getTimestamp(height) || new Date();
        
        // Get epoch info
        const epochInfo = await this.epochService.getCurrentEpochInfo();
        const blocksPerEpoch = 360;
        const currentEpochStart = epochInfo.boundary - blocksPerEpoch + 1;
        
        // Calculate epoch number
        const heightEpoch = epochInfo.epochNumber + Math.floor((height - currentEpochStart) / blocksPerEpoch);

        // For each client, prepare and send block info
        for (const [clientId] of this.sseManager.getClients()) {
            const normalizedPk = this.sseManager.getClientFpBtcPkHex(clientId)?.toLowerCase();
            if (!normalizedPk) continue;

            const blockInfo: BlockSignatureInfo = {
                height,
                signed: signers ? signers.has(normalizedPk) : false,
                status: !signers ? 'unknown' : (signers.has(normalizedPk) ? 'signed' : 'missed'),
                timestamp,
                epochNumber: heightEpoch
            };

            this.sseManager.broadcastBlock(blockInfo);
        }
    }

    public addSSEClient(clientId: string, res: Response, fpBtcPkHex: string): void {
        this.sseManager.addClient(
            clientId,
            res,
            fpBtcPkHex,
            (params) => this.getSignatureStats(params),
            this.lastProcessedHeight + 2 // Current height is lastProcessedHeight + 2
        );
    }

    public getLastProcessedHeight(): number {
        return this.lastProcessedHeight;
    }

    public setSignatureService(service: FinalitySignatureService): void {
        this.signatureService = service;
    }

    private getSignatureStats(params: SignatureStatsParams): Promise<SignatureStats> {
        if (!this.signatureService) {
            throw new Error('SignatureService not initialized');
        }
        return this.signatureService.getSignatureStats(params);
    }

    public isProcessing(height: number): boolean {
        return this.processingBlocks.has(height);
    }
} 