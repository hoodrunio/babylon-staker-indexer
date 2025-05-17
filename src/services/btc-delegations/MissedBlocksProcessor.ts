import { RateLimiter } from '../../utils/RateLimiter';
import { BTCDelegationEventHandler } from './BTCDelegationEventHandler';
import { BabylonClient } from '../../clients/BabylonClient';
import { logger } from '../../utils/logger';

interface BTCStakingEvent {
    events: Array<{
        type: string;
        attributes: Array<{
            key: string;
            value: string;
        }>;
    }>;
    height: number;
    hash?: string;
    sender?: string;
}

interface TxSearchResult {
    txs: Array<{
        hash: string;
        height: string;
        tx_result: {
            events: Array<{
                type: string;
                attributes: Array<{
                    key: string;
                    value: string;
                }>;
            }>;
        };
    }>;
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

    /**
     * Processes missed blocks by fetching and storing data for each missed block
     * 
     * @param fromHeight - Starting height (inclusive)
     * @param toHeight - Ending height (inclusive)
     * @param babylonClient - The BabylonClient instance to use
     */
    public async processMissedBlocks(
        fromHeight: number,
        toHeight: number,
        babylonClient: BabylonClient
    ): Promise<void> {
        if (fromHeight > toHeight) {
            logger.warn(`Invalid height range: ${fromHeight} > ${toHeight}, skipping processing`);
            return;
        }

        const numberOfBlocks = toHeight - fromHeight + 1;
        const network = babylonClient.getNetwork();
        logger.info(`Processing ${numberOfBlocks} missed block(s) on ${network} from ${fromHeight} to ${toHeight}`);
        
        const heightRanges = this.createHeightRanges(fromHeight, toHeight);
        let processedBlocks = 0;
        let failedBlocks = 0;

        for (const range of heightRanges) {
            const results = await Promise.allSettled(
                range.map(height => this.processBlockWithRateLimit(height, babylonClient))
            );

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    if (result.value) processedBlocks++;
                } else {
                    failedBlocks++;
                    logger.error(`Failed to process block ${range[index]}:`, result.reason);
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        logger.info(`Completed processing missed blocks: total: ${numberOfBlocks}, processed: ${processedBlocks}, failed: ${failedBlocks}`);
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
        height: number,
        babylonClient: BabylonClient
    ): Promise<boolean> {
        const key = `block-${height}`;
        
        while (!(await this.rateLimiter.acquire(key))) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        try {
            return await this.processSingleBlock(height, babylonClient);
        } catch (error) {
            logger.error(`Error processing block ${height}:`, error);
            throw error;
        }
    }

    private async processSingleBlock(
        height: number,
        babylonClient: BabylonClient
    ): Promise<boolean> {
        try {
            const txSearchResponse = await babylonClient.getTxSearch(height);
            
            // Check new data structure
            const txSearchResults = txSearchResponse?.result?.txs ? 
                { txs: txSearchResponse.result.txs } : 
                txSearchResponse as TxSearchResult;
                
            if (!txSearchResults?.txs) return false;

            const btcStakingEvents: BTCStakingEvent[] = [];

            for (const tx of txSearchResults.txs) {
                const events = tx.tx_result.events || [];
                for (const event of events) {
                    if (event.type.startsWith('babylon.btcstaking.v1.')) {
                        btcStakingEvents.push({
                            events: [event],
                            height: parseInt(tx.height),
                            hash: tx.hash,
                            sender: events.find((e: any) => e.type === 'message')?.attributes.find((a: any) => a.key === 'sender')?.value
                        });
                    }
                }
            }

            if (btcStakingEvents.length === 0) return false;

            // Log the events for debugging
            logger.info('Processing BTC staking events:', JSON.stringify(btcStakingEvents, null, 2));

            for (const event of btcStakingEvents) {
                await this.eventHandler.handleEvent(event);
            }

            return true;
        } catch (error) {
            if (this.isRetryableError(error)) {
                throw error;
            }
            logger.error(`Non-retryable error for block ${height}:`, error);
            return false;
        }
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