import { Network } from '../../types/finality';
import { BLSCheckpoint } from '../../database/models/BLSCheckpoint';
import { CheckpointStatusFetcher } from './CheckpointStatusFetcher';
import { convertBase64AddressToHex } from '../../utils/util';
import { logger } from '../../utils/logger';

export class CheckpointStatusHandler {
    private static instance: CheckpointStatusHandler | null = null;
    private checkpointStatusFetcher: CheckpointStatusFetcher;
    private network: Network;

    private constructor() {
        this.checkpointStatusFetcher = CheckpointStatusFetcher.getInstance();

        try {
            // Get the network from the BabylonClient
            const client = this.checkpointStatusFetcher.getBabylonClient();
            this.network = client.getNetwork();
            logger.info(`[CheckpointStatus] Initialized with network: ${this.network}`);

            // If CHECKPOINT_SYNC is true, synchronize historical checkpoints
            if (process.env.CHECKPOINT_SYNC === 'true') {
                logger.info(`[CheckpointStatus] Full sync enabled, starting historical checkpoint sync for ${this.network}`);
                // Start asynchronous process but don't wait
                this.initializeHistoricalSync().catch(error => {
                    logger.error('[CheckpointStatus] Error in historical sync initialization:', error);
                });
            } else {
                logger.info('[CheckpointStatus] Full sync disabled, skipping historical checkpoint sync');
            }
        } catch (error) {
            logger.error('[CheckpointStatus] Error initializing with BabylonClient:', error);
            throw new Error('[CheckpointStatus] Failed to initialize. Please check your NETWORK environment variable.');
        }
    }

    public static getInstance(): CheckpointStatusHandler {
        if (!CheckpointStatusHandler.instance) {
            CheckpointStatusHandler.instance = new CheckpointStatusHandler();
        }
        return CheckpointStatusHandler.instance;
    }

    public async handleNewBlock(blockData: any, network: Network): Promise<void> {
        try {
            const events = blockData?.result?.data?.value?.result_finalize_block?.events;
            const blockHeight = blockData?.result?.data?.value?.block?.header?.height;
            
            logger.debug(`[CheckpointStatus] Processing block ${blockHeight} with ${events?.length || 0} events`);

            if (!events) {
                logger.info(`[CheckpointStatus] No events found in block ${blockHeight}`);
                return;
            }

            // Log checkpoint events found
            const checkpointEvents = events.filter((e: any) => e.type.includes('babylon.checkpointing.v1.EventCheckpoint'));
            if (checkpointEvents.length > 0) {
                logger.info(`[CheckpointStatus] Found ${checkpointEvents.length} checkpoint events:`, 
                    checkpointEvents.map((e: any) => e.type));
            }

            // Handle all checkpoint status events
            for (const event of events) {
                switch (event.type) {
                    case 'babylon.checkpointing.v1.EventCheckpointAccumulating':
                        logger.info(`[CheckpointStatus] Processing ACCUMULATING event in block ${blockHeight}`);
                        await this.handleAccumulatingEvent(event, network, blockData);
                        break;
                    case 'babylon.checkpointing.v1.EventCheckpointSealed':
                        logger.info(`[CheckpointStatus] Skipping SEALED event in block ${blockHeight} (handled by BLSCheckpointHandler)`);
                        break;
                    case 'babylon.checkpointing.v1.EventCheckpointSubmitted':
                    case 'babylon.checkpointing.v1.EventCheckpointConfirmed':
                    case 'babylon.checkpointing.v1.EventCheckpointFinalized':
                        logger.info(`[CheckpointStatus] Processing ${event.type.split('.').pop()} event in block ${blockHeight}`);
                        await this.handleStatusUpdateEvent(event, network, blockData);
                        break;
                }
            }
        } catch (error) {
            logger.error('[CheckpointStatus] Error handling new block:', error);
        }
    }

    private async handleAccumulatingEvent(event: any, network: Network, blockData: any): Promise<void> {
        try {
            const checkpointAttr = event.attributes?.find((attr: any) => attr.key === 'checkpoint');
            if (!checkpointAttr) {
                logger.warn('[CheckpointStatus] Could not find checkpoint attribute');
                return;
            }

            let checkpoint;
            try {
                checkpoint = JSON.parse(checkpointAttr.value);
            } catch (error) {
                logger.error('[CheckpointStatus] Error parsing checkpoint JSON:', error);
                return;
            }

            const epochNum = parseInt(checkpoint.ckpt?.epoch_num);
            if (!epochNum) {
                logger.warn('[CheckpointStatus] Could not find epoch number in checkpoint data');
                return;
            }

            // Block hash check and transformation
            const rawBlockHash = checkpoint.ckpt?.block_hash;
            if (!rawBlockHash) {
                logger.warn(`[CheckpointStatus] No block hash found for epoch ${epochNum}`);
                return;
            }

            const blockHash = convertBase64AddressToHex(rawBlockHash);
            logger.info(`[CheckpointStatus] Converted block hash from ${rawBlockHash} to ${blockHash}`);

            if (!blockHash) {
                logger.warn(`[CheckpointStatus] Failed to convert block hash for epoch ${epochNum}`);
                return;
            }

            const blockHeight = parseInt(blockData?.result?.data?.value?.block?.header?.height || '0');
            const now = new Date();

            // Add new lifecycle entry
            const newLifecycleEntry = {
                state: 'CKPT_STATUS_ACCUMULATING',
                block_height: blockHeight,
                block_time: now
            };

            // Create new checkpoint if not found
            const newCheckpoint = {
                epoch_num: epochNum,
                network,
                block_hash: blockHash,
                bitmap: checkpoint.ckpt?.bitmap || '',
                bls_multi_sig: checkpoint.ckpt?.bls_multi_sig || '',
                status: 'CKPT_STATUS_ACCUMULATING',
                bls_aggr_pk: checkpoint.bls_aggr_pk || '',
                power_sum: checkpoint.power_sum || '0',
                lifecycle: [newLifecycleEntry],
                timestamp: Math.floor(now.getTime() / 1000)
            };

            // Only create if it doesn't exist
            const existingCheckpoint = await BLSCheckpoint.findOne({
                epoch_num: epochNum,
                network
            });

            if (!existingCheckpoint) {
                await BLSCheckpoint.create(newCheckpoint);
                logger.info(`[CheckpointStatus] Created new checkpoint for epoch ${epochNum} with block hash ${blockHash}`);
            }
        } catch (error) {
            logger.error('[CheckpointStatus] Error handling accumulating event:', error);
        }
    }

    private async handleStatusUpdateEvent(event: any, network: Network, blockData: any): Promise<void> {
        try {
            const checkpointAttr = event.attributes?.find((attr: any) => attr.key === 'checkpoint');
            if (!checkpointAttr) {
                logger.warn('[CheckpointStatus] Could not find checkpoint attribute');
                return;
            }

            let checkpoint;
            try {
                checkpoint = JSON.parse(checkpointAttr.value);
            } catch (error) {
                logger.error('[CheckpointStatus] Error parsing checkpoint JSON:', error);
                return;
            }

            const epochNum = parseInt(checkpoint.ckpt?.epoch_num);
            if (!epochNum) {
                logger.warn('[CheckpointStatus] Could not find epoch number in checkpoint data');
                return;
            }

            // Block hash check and transformation
            const rawBlockHash = checkpoint.ckpt?.block_hash;
            if (!rawBlockHash) {
                logger.warn(`[CheckpointStatus] No block hash found for epoch ${epochNum}`);
                return;
            }

            const blockHash = convertBase64AddressToHex(rawBlockHash);

            const status = this.getStatusFromEventType(event.type);
            const blockHeight = parseInt(blockData?.result?.data?.value?.block?.header?.height || '0');
            const now = new Date();

            // Check if existing checkpoint exists
            const existingCheckpoint = await BLSCheckpoint.findOne({ 
                epoch_num: epochNum,
                network 
            });

            logger.info(`[CheckpointStatus] Found existing checkpoint:`, existingCheckpoint ? 'yes' : 'no');
            if (existingCheckpoint) {
                logger.info(`[CheckpointStatus] Current status: ${existingCheckpoint.status}, New status: ${status}`);
            }

            // Add new lifecycle entry
            const newLifecycleEntry = {
                state: status,
                block_height: blockHeight,
                block_time: now
            };

            // If checkpoint is not found, create new one
            if (!existingCheckpoint) {
                logger.info(`[CheckpointStatus] Creating new checkpoint for epoch ${epochNum}`);
                await BLSCheckpoint.create({
                    epoch_num: epochNum,
                    network,
                    block_hash: blockHash,
                    bitmap: checkpoint.ckpt?.bitmap || '',
                    bls_multi_sig: checkpoint.ckpt?.bls_multi_sig || '',
                    bls_aggr_pk: checkpoint.bls_aggr_pk || '',
                    power_sum: checkpoint.power_sum || '0',
                    status,
                    lifecycle: [newLifecycleEntry],
                    timestamp: Math.floor(now.getTime() / 1000)
                });
            } else {
                // Update existing checkpoint
                await BLSCheckpoint.findOneAndUpdate(
                    { 
                        epoch_num: epochNum,
                        network 
                    },
                    { 
                        $set: { 
                            status,
                            block_hash: blockHash,
                            bitmap: checkpoint.ckpt?.bitmap || '',
                            bls_multi_sig: checkpoint.ckpt?.bls_multi_sig || '',
                            bls_aggr_pk: checkpoint.bls_aggr_pk || '',
                            power_sum: checkpoint.power_sum || '0'
                        },
                        $push: { lifecycle: newLifecycleEntry }
                    }
                );
            }

            logger.info(`[CheckpointStatus] Successfully updated checkpoint ${epochNum} status to ${status} with block hash ${blockHash}`);
        } catch (error: any) {
            logger.error('[CheckpointStatus] Error handling status update event:', error);
            logger.error('[CheckpointStatus] Stack trace:', error.stack);
        }
    }

    private getStatusFromEventType(eventType: string): string {
        switch (eventType) {
            case 'babylon.checkpointing.v1.EventCheckpointAccumulating':
                return 'CKPT_STATUS_ACCUMULATING';
            case 'babylon.checkpointing.v1.EventCheckpointSealed':
                return 'CKPT_STATUS_SEALED';
            case 'babylon.checkpointing.v1.EventCheckpointSubmitted':
                return 'CKPT_STATUS_SUBMITTED';
            case 'babylon.checkpointing.v1.EventCheckpointConfirmed':
                return 'CKPT_STATUS_CONFIRMED';
            case 'babylon.checkpointing.v1.EventCheckpointFinalized':
                return 'CKPT_STATUS_FINALIZED';
            default:
                throw new Error(`Unknown event type: ${eventType}`);
        }
    }

    public async syncHistoricalCheckpoints(network: Network): Promise<void> {
        return this.checkpointStatusFetcher.syncHistoricalCheckpoints(network);
    }

    public async getCurrentEpoch(network: Network): Promise<number> {
        return this.checkpointStatusFetcher.getCurrentEpoch(network);
    }

    private async initializeHistoricalSync() {
        try {
            logger.info(`[CheckpointStatus] Starting historical sync initialization for ${this.network}`);
            
            // Start synchronization only for the configured network
            logger.info(`[CheckpointStatus] Starting historical sync for ${this.network}`);
            await this.checkpointStatusFetcher.syncHistoricalCheckpoints(this.network);
            logger.info(`[CheckpointStatus] Completed historical sync for ${this.network}`);
            
            logger.info('[CheckpointStatus] Completed historical sync initialization');
        } catch (error) {
            logger.error(`[CheckpointStatus] Error syncing historical checkpoints for ${this.network}:`, error);
            throw error;
        }
    }
} 