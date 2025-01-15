import { CacheService } from '../CacheService';

interface BlockSignatureStatus {
    height: number;
    signed: boolean;
    timestamp: number;
}

interface AggregatedStats {
    startHeight: number;
    endHeight: number;
    signedCount: number;
    missedCount: number;
    lastUpdated: number;
}

export class FinalityHistoricalService {
    private static instance: FinalityHistoricalService | null = null;
    private cache: CacheService;
    private readonly SIGNATURE_TTL = 86400; // 24 saat
    private readonly AGGREGATED_TTL = 86400; // 1 day
    private readonly BATCH_SIZE = 1000; // Her batch için blok sayısı
    private readonly BLOCK_SIGNATURE_PREFIX = 'signature:block:';
    private readonly SIGNER_SIGNATURE_PREFIX = 'signature:signer:';

    private constructor() {
        this.cache = CacheService.getInstance();
    }

    public static getInstance(): FinalityHistoricalService {
        if (!FinalityHistoricalService.instance) {
            FinalityHistoricalService.instance = new FinalityHistoricalService();
        }
        return FinalityHistoricalService.instance;
    }

    public async getBlockSignatureKeys(): Promise<string[]> {
        const pattern = `${this.BLOCK_SIGNATURE_PREFIX}*`;
        return await this.cache.keys(pattern);
    }

    public async getBlockSignature(key: string): Promise<{ signers: string[]; timestamp: number } | null> {
        return await this.cache.get<{ signers: string[]; timestamp: number }>(key);
    }

    public async saveBlockSignatures(height: number, data: { signers: string[]; timestamp: number }): Promise<void> {
        const key = `${this.BLOCK_SIGNATURE_PREFIX}${height}`;
        await this.cache.set(key, data, this.AGGREGATED_TTL);
    }

    public async deleteBlockSignature(height: number): Promise<void> {
        const key = `${this.BLOCK_SIGNATURE_PREFIX}${height}`;
        await this.cache.del(key);
    }

    private getSignatureKey(fpBtcPkHex: string, height: number): string {
        return `fp:${fpBtcPkHex}:signatures:${height}`;
    }

    private getAggregatedKey(fpBtcPkHex: string, startHeight: number, endHeight: number): string {
        return `fp:${fpBtcPkHex}:stats:${startHeight}-${endHeight}`;
    }

    public async saveBlockSignature(fpBtcPkHex: string, height: number, signed: boolean): Promise<void> {
        const key = this.getSignatureKey(fpBtcPkHex, height);
        const data: BlockSignatureStatus = {
            height,
            signed,
            timestamp: Date.now()
        };
        await this.cache.set(key, data, this.SIGNATURE_TTL);

        // Eğer bu height bir batch'in son bloğu ise, aggregation yap
        if (height % this.BATCH_SIZE === 0) {
            await this.aggregateStats(fpBtcPkHex, height - this.BATCH_SIZE + 1, height);
        }
    }

    private async aggregateStats(fpBtcPkHex: string, startHeight: number, endHeight: number): Promise<void> {
        let signedCount = 0;
        let missedCount = 0;

        // Batch içindeki tüm blokları kontrol et
        for (let height = startHeight; height <= endHeight; height++) {
            const key = this.getSignatureKey(fpBtcPkHex, height);
            const data = await this.cache.get<BlockSignatureStatus>(key);
            if (data) {
                if (data.signed) signedCount++;
                else missedCount++;
            }
        }

        const stats: AggregatedStats = {
            startHeight,
            endHeight,
            signedCount,
            missedCount,
            lastUpdated: Date.now()
        };

        const key = this.getAggregatedKey(fpBtcPkHex, startHeight, endHeight);
        await this.cache.set(key, stats, this.AGGREGATED_TTL);
    }

    public async getHistoricalStats(fpBtcPkHex: string, startHeight: number, endHeight: number): Promise<{
        signedBlocks: number;
        missedBlocks: number;
        unknownBlocks: number;
        totalBlocks: number;
    }> {
        let signedBlocks = 0;
        let missedBlocks = 0;
        let unknownBlocks = 0;

        // Önce aggregated stats'leri kontrol et
        const batchStart = Math.ceil(startHeight / this.BATCH_SIZE) * this.BATCH_SIZE;
        const batchEnd = Math.floor(endHeight / this.BATCH_SIZE) * this.BATCH_SIZE;

        // Batch'lerden önceki blokları kontrol et
        for (let height = startHeight; height < batchStart; height++) {
            const key = this.getSignatureKey(fpBtcPkHex, height);
            const data = await this.cache.get<BlockSignatureStatus>(key);
            if (data) {
                if (data.signed) signedBlocks++;
                else missedBlocks++;
            } else {
                unknownBlocks++;
            }
        }

        // Batch'leri kontrol et
        for (let height = batchStart; height <= batchEnd; height += this.BATCH_SIZE) {
            const key = this.getAggregatedKey(fpBtcPkHex, height, height + this.BATCH_SIZE - 1);
            const stats = await this.cache.get<AggregatedStats>(key);
            if (stats) {
                signedBlocks += stats.signedCount;
                missedBlocks += stats.missedCount;
            } else {
                // Eğer aggregated stats yoksa, tek tek kontrol et
                for (let h = height; h < height + this.BATCH_SIZE; h++) {
                    const sigKey = this.getSignatureKey(fpBtcPkHex, h);
                    const data = await this.cache.get<BlockSignatureStatus>(sigKey);
                    if (data) {
                        if (data.signed) signedBlocks++;
                        else missedBlocks++;
                    } else {
                        unknownBlocks++;
                    }
                }
            }
        }

        // Batch'lerden sonraki blokları kontrol et
        for (let height = batchEnd + 1; height <= endHeight; height++) {
            const key = this.getSignatureKey(fpBtcPkHex, height);
            const data = await this.cache.get<BlockSignatureStatus>(key);
            if (data) {
                if (data.signed) signedBlocks++;
                else missedBlocks++;
            } else {
                unknownBlocks++;
            }
        }

        return {
            signedBlocks,
            missedBlocks,
            unknownBlocks,
            totalBlocks: endHeight - startHeight + 1
        };
    }

    public async cleanup(currentHeight: number, retentionBlocks: number = 5000): Promise<void> {
        const threshold = currentHeight - retentionBlocks;
        await this.cache.clearPattern(`fp:*:signatures:${threshold}`);
        await this.cache.clearPattern(`fp:*:stats:${threshold}`);
    }
} 