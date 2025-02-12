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

    public async syncHistoricalCheckpoints(network: Network): Promise<void> {
        try {
            console.log(`[CheckpointStatus] Starting historical checkpoint status sync for ${network}`);

            // Get all checkpoints that need status update
            const checkpoints = await BLSCheckpoint.find({
                network,
                status: { $ne: 'CKPT_STATUS_FINALIZED' } // Only get non-finalized checkpoints
            }).sort({ epoch_num: -1 });

            console.log(`[CheckpointStatus] Found ${checkpoints.length} non-finalized checkpoints to check status for ${network}`);

            let updatedCount = 0;
            for (const checkpoint of checkpoints) {
                try {
                    const wasUpdated = await this.updateCheckpointStatus(checkpoint, network);
                    if (wasUpdated) updatedCount++;
                    
                    // Add small delay to prevent rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`[CheckpointStatus] Error updating checkpoint ${checkpoint.epoch_num}:`, error);
                    continue;
                }
            }

            console.log(`[CheckpointStatus] Completed historical checkpoint status sync for ${network}. Updated ${updatedCount}/${checkpoints.length} checkpoints`);
        } catch (error) {
            console.error(`[CheckpointStatus] Error in historical checkpoint sync for ${network}:`, error);
            throw error;
        }
    }

    private async updateCheckpointStatus(checkpoint: any, network: Network): Promise<boolean> {
        try {
            const client = this.validatorInfoService.getBabylonClient(network);
            if (!client) {
                throw new Error(`No Babylon client found for network ${network}`);
            }

            const baseUrl = client.getBaseUrl();
            
            // Get checkpoint status
            const statusResponse = await axios.get(`${baseUrl}/babylon/checkpointing/v1/epochs/${checkpoint.epoch_num}/status`);
            const status = statusResponse.data.status;

            // Get checkpoint data
            const checkpointResponse = await axios.get(`${baseUrl}/babylon/checkpointing/v1/raw_checkpoint/${checkpoint.epoch_num}`);
            const checkpointData = checkpointResponse.data.raw_checkpoint;

            if (!checkpointData) {
                console.log(`[CheckpointStatus] No checkpoint data found for epoch ${checkpoint.epoch_num}`);
                return false;
            }

            // Skip if status hasn't changed
            if (status === checkpoint.status) {
                console.log(`[CheckpointStatus] Checkpoint ${checkpoint.epoch_num} status unchanged: ${checkpoint.status}`);
                return false;
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

            // Update checkpoint with new status
            await BLSCheckpoint.findOneAndUpdate(
                { 
                    epoch_num: checkpoint.epoch_num,
                    network 
                },
                { 
                    $set: { 
                        status,
                        block_hash: convertBase64AddressToHex(checkpointData.ckpt?.block_hash || ''),
                        bitmap: checkpointData.ckpt?.bitmap,
                        bls_multi_sig: checkpointData.ckpt?.bls_multi_sig,
                        bls_aggr_pk: checkpointData.bls_aggr_pk,
                        power_sum: checkpointData.power_sum
                    },
                    $push: { lifecycle: newLifecycleEntry }
                }
            );

            console.log(`[CheckpointStatus] Updated checkpoint ${checkpoint.epoch_num} status from ${checkpoint.status} to ${status}`);
            return true;
        } catch (error) {
            console.error(`[CheckpointStatus] Error updating checkpoint ${checkpoint.epoch_num}:`, error);
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