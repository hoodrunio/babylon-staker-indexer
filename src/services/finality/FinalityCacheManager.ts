import { FinalityHistoricalService } from './FinalityHistoricalService';

export class FinalityCacheManager {
    private static instance: FinalityCacheManager | null = null;
    private signatureCache: Map<number, Set<string>> = new Map();
    private timestampCache: Map<number, Date> = new Map();
    private processedBlocks: Set<number> = new Set();
    private readonly MAX_CACHE_SIZE = 10000;
    private readonly MIN_BLOCKS_TO_KEEP = 1000;
    private historicalService: FinalityHistoricalService;

    private constructor() {
        this.historicalService = FinalityHistoricalService.getInstance();
        this.loadCacheFromRedis();
    }

    public static getInstance(): FinalityCacheManager {
        if (!FinalityCacheManager.instance) {
            FinalityCacheManager.instance = new FinalityCacheManager();
        }
        return FinalityCacheManager.instance;
    }

    private async loadCacheFromRedis(): Promise<void> {
        try {
            // Get block signatures from Redis
            const signatureKeys = await this.historicalService.getBlockSignatureKeys();
            
            for (const key of signatureKeys) {
                const blockData = await this.historicalService.getBlockSignature(key);
                if (blockData) {
                    const height = parseInt(key.split(':')[2]); // Get height from "signature:block:HEIGHT" format
                    const signers = new Set<string>(blockData.signers);
                    this.signatureCache.set(height, signers);
                    this.timestampCache.set(height, new Date(blockData.timestamp));
                    this.processedBlocks.add(height);
                }
            }

            console.debug(`[Cache] Loaded ${this.signatureCache.size} blocks from Redis`);
        } catch (error) {
            console.error('[Cache] Error loading cache from Redis:', error);
        }
    }

    public async saveBlockToRedis(height: number, signers: Set<string>): Promise<void> {
        try {
            await this.historicalService.saveBlockSignatures(height, {
                signers: Array.from(signers),
                timestamp: this.timestampCache.get(height)?.getTime() || Date.now()
            });
        } catch (error) {
            console.error(`[Cache] Error saving block ${height} to Redis:`, error);
        }
    }

    public getSigners(height: number): Set<string> | undefined {
        return this.signatureCache.get(height);
    }

    public getTimestamp(height: number): Date | undefined {
        return this.timestampCache.get(height);
    }

    public isProcessed(height: number): boolean {
        return this.processedBlocks.has(height);
    }

    public setSigners(height: number, signers: Set<string>): void {
        this.signatureCache.set(height, signers);
        if (!this.timestampCache.has(height)) {
            this.timestampCache.set(height, new Date());
        }
        this.processedBlocks.add(height);
    }

    public async processBlock(height: number, signers: Set<string>): Promise<void> {
        // Add signatures to cache
        this.setSigners(height, signers);
        
        // Save to Redis
        await this.saveBlockToRedis(height, signers);
        
        // Save for each signer in historical service
        const allSigners = Array.from(signers);
        for (const signer of allSigners) {
            await this.historicalService.saveBlockSignature(
                signer.toLowerCase(),
                height,
                true
            );
        }

        // Cleanup if needed
        await this.cleanup();
    }

    public async cleanup(): Promise<void> {
        if (this.signatureCache.size > this.MAX_CACHE_SIZE) {
            // Find oldest blocks
            const heights = Array.from(this.signatureCache.keys()).sort((a, b) => a - b);
            const oldestBlocks = heights.slice(0, heights.length - this.MIN_BLOCKS_TO_KEEP);

            if (oldestBlocks.length > 0) {
                oldestBlocks.forEach(height => {
                    this.signatureCache.delete(height);
                    this.timestampCache.delete(height);
                    this.processedBlocks.delete(height);
                });
                console.debug(`[Cache] Cleaned up ${oldestBlocks.length} old blocks from cache, current size: ${this.signatureCache.size}`);
            }
        }
    }

    public async saveMissedBlock(fpBtcPkHex: string, height: number): Promise<void> {
        await this.historicalService.saveBlockSignature(
            fpBtcPkHex.toLowerCase(),
            height,
            false
        );
    }

    public getCacheSize(): number {
        return this.signatureCache.size;
    }

    public getProcessedBlocksCount(): number {
        return this.processedBlocks.size;
    }

    public hasSignatureData(height: number): boolean {
        const signers = this.signatureCache.get(height);
        return signers !== undefined && signers.size > 0;
    }
} 