import { Network } from '../../types/finality';
import { RateLimiter } from '../../utils/RateLimiter';
import { BTCDelegationEventHandler } from './BTCDelegationEventHandler';
import { BabylonClient, BlockResult } from '../../clients/BabylonClient';

interface BTCStakingEvent {
    events: Array<{
        type: string;
        attributes: Array<{
            key: string;
            value: string;
        }>;
    }>;
    height: number;
}

export class MissedBlocksProcessor {
    private static instance: MissedBlocksProcessor | null = null;
    private readonly rateLimiter: RateLimiter;
    private readonly eventHandler: BTCDelegationEventHandler;
    private readonly BATCH_SIZE = 20;
    private readonly MAX_CONCURRENT_REQUESTS = 5;
    private readonly REQUEST_INTERVAL_MS = 1000;

    private constructor() {
        this.rateLimiter = new RateLimiter(this.MAX_CONCURRENT_REQUESTS, this.REQUEST_INTERVAL_MS);
        this.eventHandler = BTCDelegationEventHandler.getInstance();
    }

    public static getInstance(): MissedBlocksProcessor {
        if (!MissedBlocksProcessor.instance) {
            MissedBlocksProcessor.instance = new MissedBlocksProcessor();
        }
        return MissedBlocksProcessor.instance;
    }

    public async processMissedBlocks(
        network: Network,
        startHeight: number,
        endHeight: number,
        babylonClient: BabylonClient
    ) {
        console.log(`[${network}] Processing missed blocks from ${startHeight} to ${endHeight}`);
        
        const heightRanges = this.createHeightRanges(startHeight, endHeight);
        let processedBlocks = 0;
        let failedBlocks = 0;

        for (const range of heightRanges) {
            const results = await Promise.allSettled(
                range.map(height => this.processBlockWithRateLimit(network, height, babylonClient))
            );

            // Sonuçları işle
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    if (result.value) processedBlocks++;
                } else {
                    failedBlocks++;
                    console.error(`[${network}] Failed to process block ${range[index]}:`, result.reason);
                }
            });

            // Her batch sonrası kısa bir bekleme
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`[${network}] Completed processing missed blocks:`, {
            total: endHeight - startHeight + 1,
            processed: processedBlocks,
            failed: failedBlocks
        });
    }

    private createHeightRanges(startHeight: number, endHeight: number): number[][] {
        const ranges: number[][] = [];
        for (let i = startHeight; i <= endHeight; i += this.BATCH_SIZE) {
            const end = Math.min(i + this.BATCH_SIZE - 1, endHeight);
            ranges.push(Array.from({ length: end - i + 1 }, (_, idx) => i + idx));
        }
        return ranges;
    }

    private async processBlockWithRateLimit(
        network: Network,
        height: number,
        babylonClient: BabylonClient
    ): Promise<boolean> {
        const key = `${network}-${height}`;
        
        while (!(await this.rateLimiter.acquire(key))) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        try {
            return await this.processBlockResults(network, height, babylonClient);
        } catch (error) {
            console.error(`[${network}] Error processing block ${height}:`, error);
            throw error;
        }
    }

    private async processBlockResults(
        network: Network,
        height: number,
        babylonClient: BabylonClient
    ): Promise<boolean> {
        try {
            const blockResults = await babylonClient.getBlockResults(height);
            if (!blockResults?.txs_results) return false;

            const btcStakingEvents = this.extractBTCStakingEvents(blockResults);
            if (btcStakingEvents.length === 0) return false;

            for (const event of btcStakingEvents) {
                await this.eventHandler.handleEvent(event, network);
            }

            return true;
        } catch (error) {
            if (this.isRetryableError(error)) {
                throw error; // Rate limiter tekrar deneyecek
            }
            console.error(`[${network}] Non-retryable error for block ${height}:`, error);
            return false;
        }
    }

    private extractBTCStakingEvents(blockResults: BlockResult): BTCStakingEvent[] {
        const btcStakingEvents: BTCStakingEvent[] = [];
        
        for (const txResult of blockResults.txs_results) {
            const events = txResult.events || [];
            for (const event of events) {
                if (event.type.startsWith('babylon.btcstaking.v1.')) {
                    btcStakingEvents.push({
                        events: [event],
                        height: blockResults.height
                    });
                }
            }
        }

        return btcStakingEvents;
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof Error) {
            return error.message?.includes('rate limit') ||
                   error.message?.includes('timeout') ||
                   error.message?.includes('socket hang up') ||
                   (error as any).code === 'ECONNRESET' ||
                   (error as any).code === 'ETIMEDOUT';
        }
        return false;
    }
}