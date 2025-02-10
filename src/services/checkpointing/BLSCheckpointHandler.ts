import { Network } from '../../types/finality';
import { BLSCheckpointFetcher } from './BLSCheckpointFetcher';

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
            console.log(`[BLSCheckpoint] Raw event received:`, {
                network,
                event: JSON.stringify(event, null, 2)
            });

            // Find checkpoint event in the NewBlock event structure
            const checkpointEvent = event.data?.value?.result_finalize_block?.events?.find((e: any) => 
                e.type === 'babylon.checkpointing.v1.EventCheckpointSealed'
            );

            if (!checkpointEvent) {
                return;
            }

            // Extract checkpoint data from attributes
            const checkpointAttr = checkpointEvent.attributes?.find((attr: any) => 
                attr.key === 'checkpoint'
            );

            if (!checkpointAttr) {
                console.warn('[BLSCheckpoint] Could not find checkpoint attribute');
                return;
            }

            // Parse checkpoint JSON
            let checkpoint;
            try {
                checkpoint = JSON.parse(checkpointAttr.value);
            } catch (error) {
                console.error('[BLSCheckpoint] Error parsing checkpoint JSON:', error);
                return;
            }

            // Extract epoch number from checkpoint data
            const epochNum = parseInt(checkpoint.ckpt?.epoch_num);
            if (!epochNum) {
                console.warn('[BLSCheckpoint] Could not find epoch number in checkpoint data');
                return;
            }

            // Log checkpoint details
            console.log(`[BLSCheckpoint] Processing checkpoint for epoch ${epochNum}:`, {
                network,
                status: checkpoint.status,
                block_hash: checkpoint.ckpt.block_hash,
                power_sum: checkpoint.power_sum,
                lifecycle: checkpoint.lifecycle
            });

            // Fetch complete checkpoint data including BLS signatures
            await this.checkpointFetcher.fetchCheckpointForEpoch(epochNum, network);

        } catch (error) {
            console.error('[BLSCheckpoint] Error handling checkpoint event:', error);
            throw error;
        }
    }
} 