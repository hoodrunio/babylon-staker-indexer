import { Network } from '../../types/finality';
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

    public async processMissedBlocks(
        network: Network,
        startHeight: number,
        endHeight: number,
        babylonClient: BabylonClient
    ) {
        logger.info(`[${network}] Processing missed blocks from ${startHeight} to ${endHeight}`);
        
        const heightRanges = this.createHeightRanges(startHeight, endHeight);
        let processedBlocks = 0;
        let failedBlocks = 0;

        for (const range of heightRanges) {
            const results = await Promise.allSettled(
                range.map(height => this.processBlockWithRateLimit(network, height, babylonClient))
            );

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    if (result.value) processedBlocks++;
                } else {
                    failedBlocks++;
                    logger.error(`[${network}] Failed to process block ${range[index]}:`, result.reason);
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        logger.info(`[${network}] Completed processing missed blocks: total: ${endHeight - startHeight + 1}, processed: ${processedBlocks}, failed: ${failedBlocks}`);
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
            logger.error(`[${network}] Error processing block ${height}:`, error);
            throw error;
        }
    }

    private async processBlockResults(
        network: Network,
        height: number,
        babylonClient: BabylonClient
    ): Promise<boolean> {
        try {
            const txSearchResponse = await babylonClient.getTxSearch(height);
            
            // Yeni veri yapısı kontrolü
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
                await this.eventHandler.handleEvent(event, network);
            }

            return true;
        } catch (error) {
            if (this.isRetryableError(error)) {
                throw error;
            }
            logger.error(`[${network}] Non-retryable error for block ${height}:`, error);
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