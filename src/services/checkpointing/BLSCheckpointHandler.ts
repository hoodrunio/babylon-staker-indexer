import { Network } from '../../types/finality';
import { BLSCheckpointFetcher } from './BLSCheckpointFetcher';
import { logger } from '../../utils/logger';

export class BLSCheckpointHandler {
    private static instance: BLSCheckpointHandler | null = null;
    private checkpointFetcher: BLSCheckpointFetcher;

    private constructor() {
        this.checkpointFetcher = BLSCheckpointFetcher.getInstance();
    }

    public static getInstance(): BLSCheckpointHandler {
        if (!BLSCheckpointHandler.instance) {
            BLSCheckpointHandler.instance = new BLSCheckpointHandler();
        }
        return BLSCheckpointHandler.instance;
    }

    public async handleCheckpoint(event: any, network: Network): Promise<void> {
        try {
            // Log raw event for debugging
            /* logger.info(`[BLSCheckpoint] Raw event received:`, {
                network,
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
            await this.checkpointFetcher.fetchCheckpointForEpoch(epochNum, network);

        } catch (error) {
            logger.error('[BLSCheckpoint] Error handling checkpoint event:', error);
            throw error;
        }
    }
} 