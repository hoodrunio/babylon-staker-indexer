import { BLSCheckpointFetcher } from './BLSCheckpointFetcher';
import { logger } from '../../utils/logger';
import { BabylonClient } from '../../clients/BabylonClient';

export class BLSCheckpointHandler {
    private static instance: BLSCheckpointHandler | null = null;
    private checkpointFetcher: BLSCheckpointFetcher;
    private babylonClient: BabylonClient;

    private constructor() {
        this.checkpointFetcher = BLSCheckpointFetcher.getInstance();
        this.babylonClient = BabylonClient.getInstance();
    }

    public static getInstance(): BLSCheckpointHandler {
        if (!BLSCheckpointHandler.instance) {
            BLSCheckpointHandler.instance = new BLSCheckpointHandler();
        }
        return BLSCheckpointHandler.instance;
    }

    public async handleCheckpoint(event: any): Promise<void> {
        const MAX_RETRIES = 3;
        const INITIAL_RETRY_DELAY = 3000; // 3 seconds
        const MAX_RETRY_DELAY = 15000; // 15 seconds
        let retryCount = 0;

        while (retryCount < MAX_RETRIES) {
            try {
                // Log raw event for debugging
                /* logger.info(`[BLSCheckpoint] Raw event received:`, {
                    hasEvents: !!event.events,
                    eventsCount: event.events?.length,
                    eventTypes: event.events?.map((e: any) => e.type)
                }); */

                if (!event.events) {
                    logger.info('[BLSCheckpoint] No events found in finalize block event');
                    return;
                }

                // Find checkpoint event in the events array
                const checkpointEvent = event.events.find((e: any) => 
                    e.type === 'babylon.checkpointing.v1.EventCheckpointSealed'
                );

                if (!checkpointEvent) {
                    logger.info('[BLSCheckpoint] No checkpoint event found in events array');
                    return;
                }

                logger.info('[BLSCheckpoint] Found checkpoint event');

                // Extract checkpoint data from attributes
                const checkpointAttr = checkpointEvent.attributes?.find((attr: any) => 
                    attr.key === 'checkpoint'
                );

                if (!checkpointAttr) {
                    logger.warn('[BLSCheckpoint] Could not find checkpoint attribute');
                    return;
                }

                // Parse checkpoint JSON
                let checkpoint;
                try {
                    checkpoint = JSON.parse(checkpointAttr.value);
                    logger.info('[BLSCheckpoint] New checkpoint sealed:', checkpoint?.ckpt?.epoch_num);
                } catch (error) {
                    logger.error('[BLSCheckpoint] Error parsing checkpoint JSON:', error);
                    return;
                }

                // Extract epoch number from checkpoint data
                const epochNum = parseInt(checkpoint.ckpt?.epoch_num);
                if (!epochNum) {
                    logger.warn('[BLSCheckpoint] Could not find epoch number in checkpoint data');
                    return;
                }

                // Log checkpoint details
                logger.info(`[BLSCheckpoint] Processing checkpoint for epoch ${epochNum}`);

                // Fetch complete checkpoint data including BLS signatures
                await this.checkpointFetcher.fetchCheckpointForEpoch(epochNum);
                
                // If successful, break out of retry loop
                return;

            } catch (error: any) {
                // Only retry for specific error types that indicate sync issues
                const errorMessage = error.message || String(error);
                const isHeightError = 
                    errorMessage.includes('invalid height') ||
                    errorMessage.includes('must not be less than') ||
                    errorMessage.includes('greater than the current height') ||
                    error.response?.status === 500;
                
                if (isHeightError) {
                    retryCount++;
                    
                    if (retryCount >= MAX_RETRIES) {
                        logger.error(`[BLSCheckpoint] Max retries (${MAX_RETRIES}) exceeded when handling checkpoint event`);
                        throw error;
                    }
                    
                    // Calculate backoff delay with exponential increase
                    const retryDelay = Math.min(
                        MAX_RETRY_DELAY,
                        INITIAL_RETRY_DELAY * Math.pow(2, retryCount)
                    );
                    
                    logger.info(`[BLSCheckpoint] Node may be out of sync. Retrying (${retryCount}/${MAX_RETRIES}) in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                }
                
                // For non-retriable errors, log and throw
                logger.error('[BLSCheckpoint] Error handling checkpoint event:', error);
                throw error;
            }
        }
    }
} 