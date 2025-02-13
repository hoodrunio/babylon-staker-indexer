import { Network } from '../../types/finality';
import { BLSCheckpoint } from '../../database/models/BLSCheckpoint';
import { ValidatorInfoService } from '../validator/ValidatorInfoService';
import axios from 'axios';
import { convertBase64AddressToHex } from '../../utils/util';

export class CheckpointStatusFetcher {
    private static instance: CheckpointStatusFetcher | null = null;
    private validatorInfoService: ValidatorInfoService;

    private constructor() {
        this.validatorInfoService = ValidatorInfoService.getInstance();
    }

    public getBabylonClient(network: Network) {
        return this.validatorInfoService.getBabylonClient(network);
    }

    public static getInstance(): CheckpointStatusFetcher {
        if (!CheckpointStatusFetcher.instance) {
            CheckpointStatusFetcher.instance = new CheckpointStatusFetcher();
        }
        return CheckpointStatusFetcher.instance;
    }

    public async syncHistoricalCheckpoints(network: Network, batchSize: number = 50): Promise<void> {
        try {
            console.log(`[CheckpointStatus] Starting historical checkpoint status sync for ${network}`);

            // Get all checkpoints that need status update
            const checkpoints = await BLSCheckpoint.find({
                network,
                status: { $ne: 'CKPT_STATUS_FINALIZED' } // Only get non-finalized checkpoints
            }).sort({ epoch_num: -1 });

            console.log(`[CheckpointStatus] Found ${checkpoints.length} non-finalized checkpoints to check status for ${network}`);

            let updatedCount = 0;
            // Process checkpoints in batches
            for (let i = 0; i < checkpoints.length; i += batchSize) {
                const batch = checkpoints.slice(i, i + batchSize);
                console.log(`[CheckpointStatus] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(checkpoints.length/batchSize)}`);

                // Collect all status updates first
                const statusUpdates = await Promise.all(
                    batch.map(async checkpoint => {
                        try {
                            const client = await this.validatorInfoService.getBabylonClient(network);
                            if (!client) {
                                throw new Error(`No Babylon client found for network ${network}`);
                            }

                            const baseUrl = client.getBaseUrl();
                            const [statusResponse, checkpointResponse] = await Promise.all([
                                axios.get(`${baseUrl}/babylon/checkpointing/v1/epochs/${checkpoint.epoch_num}/status`),
                                axios.get(`${baseUrl}/babylon/checkpointing/v1/raw_checkpoint/${checkpoint.epoch_num}`)
                            ]);

                            return {
                                checkpoint,
                                status: statusResponse.data.status,
                                checkpointData: checkpointResponse.data.raw_checkpoint
                            };
                        } catch (error) {
                            console.error(`[CheckpointStatus] Error fetching status for checkpoint ${checkpoint.epoch_num}:`, error);
                            return null;
                        }
                    })
                );

                // Process updates sequentially
                for (const update of statusUpdates) {
                    if (!update) continue;

                    try {
                        const { checkpoint, status, checkpointData } = update;

                        // Skip if status hasn't changed
                        if (status === checkpoint.status) {
                            console.log(`[CheckpointStatus] Checkpoint ${checkpoint.epoch_num} status unchanged: ${checkpoint.status}`);
                            continue;
                        }

                        // Get block height from the last lifecycle entry
                        const lastLifecycle = checkpoint.lifecycle[checkpoint.lifecycle.length - 1];
                        const blockHeight = lastLifecycle ? lastLifecycle.block_height + 1 : 0;

                        // Add new lifecycle entry
                        const newLifecycleEntry = {
                            state: status,
                            block_height: blockHeight,
                            block_time: new Date()
                        };

                        const rawBlockHash = checkpointData.ckpt?.block_hash_hex.toUpperCase();
                        
                        // Update checkpoint with new status
                        await BLSCheckpoint.findOneAndUpdate(
                            { 
                                epoch_num: checkpoint.epoch_num,
                                network 
                            },
                            { 
                                $set: { 
                                    status,
                                    block_hash: rawBlockHash,
                                    bitmap: checkpointData.ckpt?.bitmap,
                                    bls_multi_sig: checkpointData.ckpt?.bls_multi_sig,
                                    bls_aggr_pk: checkpointData.bls_aggr_pk,
                                    power_sum: checkpointData.power_sum
                                },
                                $push: { lifecycle: newLifecycleEntry }
                            }
                        );

                        updatedCount++;
                        console.log(`[CheckpointStatus] Updated checkpoint ${checkpoint.epoch_num} status from ${checkpoint.status} to ${status}`);
                    } catch (error) {
                        console.error(`[CheckpointStatus] Error updating checkpoint in database:`, error);
                    }
                }

                // Add delay between batches to prevent rate limiting
                if (i + batchSize < checkpoints.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log(`[CheckpointStatus] Completed historical checkpoint status sync for ${network}. Updated ${updatedCount}/${checkpoints.length} checkpoints`);
        } catch (error) {
            console.error(`[CheckpointStatus] Error in historical checkpoint sync for ${network}:`, error);
            throw error;
        }
    }

    public async getCurrentEpoch(network: Network): Promise<number> {
        try {
            const client = this.validatorInfoService.getBabylonClient(network);
            if (!client) {
                throw new Error(`No Babylon client found for network ${network}`);
            }

            const baseUrl = client.getBaseUrl();
            const response = await axios.get(`${baseUrl}/babylon/epoching/v1/current_epoch`);
            return parseInt(response.data.epoch_number);
        } catch (error) {
            console.error(`[CheckpointStatus] Error getting current epoch:`, error);
            throw error;
        }
    }
} 