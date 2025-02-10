import { BLSValidatorSignature } from '../../database/models/BLSValidatorSignature';
import { BLSCheckpoint } from '../../database/models/BLSCheckpoint';
import { ValidatorInfoService } from '../validator/ValidatorInfoService';
import { Network } from '../../types/finality';
import { convertBase64AddressToHex } from '../../utils/util';
import axios from 'axios';
import { BLSValidatorSignatures } from '../../database/models/BLSValidatorSignatures';

enum CheckpointStatus {
    ACCUMULATING = 'CKPT_STATUS_ACCUMULATING',
    SEALED = 'CKPT_STATUS_SEALED',
    SUBMITTED = 'CKPT_STATUS_SUBMITTED',
    CONFIRMED = 'CKPT_STATUS_CONFIRMED',
    FINALIZED = 'CKPT_STATUS_FINALIZED'
}

export class BLSCheckpointService {
    private static instance: BLSCheckpointService | null = null;
    private validatorInfoService: ValidatorInfoService;

    private constructor() {
        this.validatorInfoService = ValidatorInfoService.getInstance();
    }

    public static getInstance(): BLSCheckpointService {
        if (!BLSCheckpointService.instance) {
            BLSCheckpointService.instance = new BLSCheckpointService();
        }
        return BLSCheckpointService.instance;
    }

    public async handleCheckpoint(event: any, network: Network): Promise<void> {
        try {
            const checkpointEvent = event.events.find((e: any) => 
                e.type === 'babylon.checkpointing.v1.EventCheckpointFinalized' ||
                e.type === 'babylon.checkpointing.v1.EventCheckpointCreated'
            );

            if (!checkpointEvent) {
                return;
            }

            const ckpt = checkpointEvent.ckpt;
            if (!ckpt || !ckpt.ckpt) {
                console.warn('[BLSCheckpoint] Invalid checkpoint data');
                return;
            }

            // Store checkpoint in MongoDB
            await BLSCheckpoint.findOneAndUpdate(
                { 
                    epoch_num: ckpt.ckpt.epoch_num,
                    network 
                },
                {
                    block_hash: ckpt.ckpt.block_hash,
                    bitmap: ckpt.ckpt.bitmap,
                    bls_multi_sig: ckpt.ckpt.bls_multi_sig,
                    status: ckpt.status,
                    bls_aggr_pk: ckpt.bls_aggr_pk,
                    power_sum: ckpt.power_sum,
                    $push: { lifecycle: ckpt.lifecycle }
                },
                { upsert: true, new: true }
            );

            // Log checkpoint details
            console.log(`[BLSCheckpoint] Processing checkpoint for epoch ${ckpt.ckpt.epoch_num}`, {
                network,
                epoch: ckpt.ckpt.epoch_num,
                status: ckpt.status,
                block_hash: ckpt.ckpt.block_hash,
                power_sum: ckpt.power_sum,
                event_type: checkpointEvent.type,
                lifecycle: ckpt.lifecycle?.map((update: any) => ({
                    state: update.state,
                    block_height: update.block_height,
                    block_time: update.block_time
                }))
            });

            // Process validator votes
            if (event.extended_commit_info?.votes) {
                const votes = event.extended_commit_info.votes;
                const signedValidators = await Promise.all(
                    votes
                        .filter((vote: any) => vote.block_id_flag === 'BLOCK_ID_FLAG_COMMIT')
                        .map(async (vote: any) => {
                            const hexAddress = convertBase64AddressToHex(vote.validator.address);
                            const validatorInfo = await this.validatorInfoService.getValidatorByHexAddress(hexAddress, network);
                            
                            return {
                                epoch_num: ckpt.ckpt.epoch_num,
                                network,
                                validator_address: hexAddress,
                                validator_power: vote.validator.power,
                                vote_extension: vote.vote_extension,
                                extension_signature: vote.extension_signature,
                                // Include validator info if available
                                moniker: validatorInfo?.moniker || 'Unknown',
                                valoper_address: validatorInfo?.valoper_address || '',
                                website: validatorInfo?.website || ''
                            };
                        })
                );

                // Store validator signatures in MongoDB
                if (signedValidators.length > 0) {
                    await BLSValidatorSignature.insertMany(
                        signedValidators,
                        { ordered: false }
                    ).catch(err => {
                        if (err.code !== 11000) {
                            throw err;
                        }
                    });
                }

                const unsignedValidators = await Promise.all(
                    votes
                        .filter((vote: any) => vote.block_id_flag === 'BLOCK_ID_FLAG_ABSENT')
                        .map(async (vote: any) => {
                            const hexAddress = convertBase64AddressToHex(vote.validator.address);
                            const validatorInfo = await this.validatorInfoService.getValidatorByHexAddress(hexAddress, network);
                            
                            return {
                                address: hexAddress,
                                power: vote.validator.power,
                                moniker: validatorInfo?.moniker || 'Unknown',
                                valoper_address: validatorInfo?.valoper_address || ''
                            };
                        })
                );

                // Enhanced logging with validator info
                console.log(`[BLSCheckpoint] Validator participation for epoch ${ckpt.ckpt.epoch_num}:`, {
                    network,
                    total_validators: votes.length,
                    signed: {
                        count: signedValidators.length,
                        validators: signedValidators.map(v => ({
                            moniker: v.moniker,
                            valoper_address: v.valoper_address,
                            power: v.validator_power
                        }))
                    },
                    unsigned: {
                        count: unsignedValidators.length,
                        validators: unsignedValidators.map(v => ({
                            moniker: v.moniker,
                            valoper_address: v.valoper_address,
                            power: v.power
                        }))
                    },
                    participation_rate: ((signedValidators.length / votes.length) * 100).toFixed(2) + '%',
                    total_power: votes.reduce((sum: number, vote: any) => sum + parseInt(vote.validator.power), 0),
                    signed_power: signedValidators.reduce((sum: number, v: any) => sum + parseInt(v.validator_power), 0)
                });

                if (ckpt.status === CheckpointStatus.FINALIZED) {
                    console.log(`[BLSCheckpoint] Checkpoint for epoch ${ckpt.ckpt.epoch_num} is finalized on Bitcoin`);
                }
            }
        } catch (error) {
            console.error('[BLSCheckpoint] Error handling checkpoint:', error);
            throw error;
        }
    }

    public async getCheckpointByEpoch(epochNum: number, network: Network): Promise<any> {
        try {
            const checkpoint = await BLSCheckpoint.findOne({
                epoch_num: epochNum,
                network
            });

            if (checkpoint) {
                const validatorSignatures = await BLSValidatorSignature.find({
                    epoch_num: epochNum,
                    network
                });

                // Enrich validator signatures with validator info
                const enrichedSignatures = await Promise.all(
                    validatorSignatures.map(async (sig) => {
                        const validatorInfo = await this.validatorInfoService.getValidatorByHexAddress(sig.validator_address, network);
                        return {
                            ...sig.toObject(),
                            moniker: validatorInfo?.moniker || 'Unknown',
                            valoper_address: validatorInfo?.valoper_address || '',
                            website: validatorInfo?.website || ''
                        };
                    })
                );

                return {
                    ...checkpoint.toObject(),
                    validator_signatures: enrichedSignatures
                };
            }

            return null;
        } catch (error) {
            console.error('Error getting checkpoint:', error);
            throw error;
        }
    }

    private async calculateBlockHeightForEpoch(epochNum: number, network: Network): Promise<number> {
        try {
            const client = this.validatorInfoService.getBabylonClient(network);
            if (!client) {
                throw new Error(`No Babylon client found for network ${network}`);
            }

            // Each epoch is 100 blocks
            const epochLength = 360;
            const epochBoundary = epochNum * epochLength;
            
            // We want the block right after the epoch boundary
            const targetHeight = epochBoundary + 1;
            
            console.log(`[BLSCheckpoint] Calculated block height ${targetHeight} for epoch ${epochNum}`);
            return targetHeight;
        } catch (error) {
            console.error(`[BLSCheckpoint] Error calculating block height for epoch ${epochNum}:`, error);
            throw error;
        }
    }

    public async fetchCheckpointForEpoch(epochNum: number, network: Network): Promise<void> {
        try {
            const height = await this.calculateBlockHeightForEpoch(epochNum, network);
            await this.fetchCheckpointFromHeight(height, network);
        } catch (error) {
            console.error(`[BLSCheckpoint] Error fetching checkpoint for epoch ${epochNum}:`, error);
            throw error;
        }
    }

    private async fetchCheckpointFromHeight(height: number, network: Network): Promise<void> {
        try {
            const client = this.validatorInfoService.getBabylonClient(network);
            if (!client) {
                throw new Error(`No Babylon client found for network ${network}`);
            }

            const baseUrl = client.getBaseUrl();
            console.log(`[BLSCheckpoint] Fetching checkpoint from height ${height} on ${network}`);

            const response = await axios.get(`${baseUrl}/cosmos/tx/v1beta1/txs/block/${height}`);
            const txs = response.data.txs || [];

            // Find checkpoint transactions
            const checkpointTxs = txs.filter((tx: any) => {
                const messages = tx.body?.messages || [];
                return messages.some((msg: any) => 
                    msg['@type'] === '/babylon.checkpointing.v1.MsgInjectedCheckpoint'
                );
            });

            if (checkpointTxs.length === 0) {
                console.log(`[BLSCheckpoint] No checkpoint transactions found at height ${height}`);
                return;
            }

            // Process each checkpoint transaction
            for (const tx of checkpointTxs) {
                const checkpointMsgs = tx.body.messages.filter(
                    (msg: any) => msg['@type'] === '/babylon.checkpointing.v1.MsgInjectedCheckpoint'
                );

                for (const msg of checkpointMsgs) {
                    try {
                        // Store checkpoint in MongoDB
                        const checkpoint = {
                            epoch_num: parseInt(msg.ckpt.ckpt.epoch_num),
                            block_hash: msg.ckpt.ckpt.block_hash,
                            bitmap: msg.ckpt.ckpt.bitmap,
                            bls_multi_sig: msg.ckpt.ckpt.bls_multi_sig,
                            status: msg.ckpt.status,
                            bls_aggr_pk: msg.ckpt.bls_aggr_pk,
                            power_sum: msg.ckpt.power_sum,
                            network,
                            lifecycle: msg.ckpt.lifecycle || []
                        };

                        await BLSCheckpoint.findOneAndUpdate(
                            { 
                                epoch_num: checkpoint.epoch_num,
                                network 
                            },
                            checkpoint,
                            { upsert: true, new: true }
                        );

                        // Log checkpoint details
                        console.log(`[BLSCheckpoint] Processing checkpoint for epoch ${checkpoint.epoch_num}`, {
                            network,
                            epoch: checkpoint.epoch_num,
                            status: checkpoint.status,
                            block_hash: checkpoint.block_hash,
                            power_sum: checkpoint.power_sum
                        });

                        // Process validator votes if available
                        if (msg.extended_commit_info?.votes) {
                            const votes = msg.extended_commit_info.votes;
                            const allValidators = await Promise.all(
                                votes.map(async (vote: any) => {
                                    const hexAddress = convertBase64AddressToHex(vote.validator.address);
                                    const validatorInfo = await this.validatorInfoService.getValidatorByHexAddress(hexAddress, network);
                                    const signed = vote.block_id_flag === 'BLOCK_ID_FLAG_COMMIT';
                                    
                                    return {
                                        validator_address: hexAddress,
                                        validator_power: vote.validator.power,
                                        signed,
                                        vote_extension: signed ? vote.vote_extension : undefined,
                                        extension_signature: signed ? vote.extension_signature : undefined,
                                        moniker: validatorInfo?.moniker || 'Unknown',
                                        valoper_address: validatorInfo?.valoper_address || ''
                                    };
                                })
                            );

                            // Calculate statistics for logging
                            const signedValidators = allValidators.filter(v => v.signed);
                            const unsignedValidators = allValidators.filter(v => !v.signed);
                            const totalPower = allValidators.reduce((sum, v) => sum + parseInt(v.validator_power), 0);
                            const signedPower = signedValidators.reduce((sum, v) => sum + parseInt(v.validator_power), 0);
                            const unsignedPower = totalPower - signedPower;
                            const byCount = ((signedValidators.length / allValidators.length) * 100).toFixed(2) + '%';
                            const byPower = ((signedPower / totalPower) * 100).toFixed(2) + '%';

                            // Store all validator signatures and stats in a single document
                            await BLSValidatorSignatures.findOneAndUpdate(
                                {
                                    epoch_num: checkpoint.epoch_num,
                                    network
                                },
                                {
                                    signatures: allValidators,
                                    stats: {
                                        total_validators: allValidators.length,
                                        total_power: totalPower.toString(),
                                        signed_power: signedPower.toString(),
                                        unsigned_power: unsignedPower.toString(),
                                        by_count: byCount,
                                        by_power: byPower
                                    }
                                },
                                { upsert: true, new: true }
                            );

                            // Log participation details
                            console.log(`[BLSCheckpoint] Validator participation for epoch ${checkpoint.epoch_num}:`, {
                                network,
                                total_validators: allValidators.length,
                                signed: {
                                    count: signedValidators.length,
                                    power: signedPower,
                                    validators: signedValidators.map(v => ({
                                        moniker: v.moniker,
                                        valoper_address: v.valoper_address,
                                        power: v.validator_power
                                    }))
                                },
                                unsigned: {
                                    count: unsignedValidators.length,
                                    power: unsignedPower,
                                    validators: unsignedValidators.map(v => ({
                                        moniker: v.moniker,
                                        valoper_address: v.valoper_address,
                                        power: v.validator_power
                                    }))
                                },
                                participation_rate: {
                                    by_count: byCount,
                                    by_power: byPower
                                }
                            });
                        }

                    } catch (error) {
                        console.error(`[BLSCheckpoint] Error processing checkpoint message:`, error);
                        continue;
                    }
                }
            }

            console.log(`[BLSCheckpoint] Successfully processed ${checkpointTxs.length} checkpoint transaction(s) from height ${height}`);
        } catch (error) {
            console.error(`[BLSCheckpoint] Error fetching checkpoint from height ${height}:`, error);
            throw error;
        }
    }

    public async syncHistoricalCheckpoints(network: Network): Promise<void> {
        try {
            const client = this.validatorInfoService.getBabylonClient(network);
            if (!client) {
                throw new Error(`No Babylon client found for network ${network}`);
            }

            // Get current epoch from the chain
            const currentEpoch = await this.getCurrentEpoch(network);

            if (isNaN(currentEpoch)) {
                console.error('[BLSCheckpoint] Failed to get current epoch from node');
                throw new Error('Invalid current epoch from node');
            }

            console.log(`[BLSCheckpoint] Starting historical sync from epoch ${currentEpoch - 1}`);

            let lowestAvailableHeight: number | null = null;

            // Start from the previous epoch and go backwards
            for (let epoch = currentEpoch - 1; epoch >= 0; epoch--) {
                try {
                    // If we know the lowest height and this epoch would be below it, stop
                    if (lowestAvailableHeight !== null) {
                        const epochHeight = await this.calculateBlockHeightForEpoch(epoch, network);
                        if (epochHeight < lowestAvailableHeight) {
                            console.log(`[BLSCheckpoint] Stopping sync as epoch ${epoch} (height ${epochHeight}) is below lowest available height ${lowestAvailableHeight}`);
                            break;
                        }
                    }

                    // Check if we already have this checkpoint
                    const existingCheckpoint = await BLSCheckpoint.findOne({
                        epoch_num: epoch,
                        network
                    });

                    if (existingCheckpoint) {
                        console.log(`[BLSCheckpoint] Checkpoint for epoch ${epoch} already exists, skipping...`);
                        continue;
                    }

                    await this.fetchCheckpointForEpoch(epoch, network);
                    console.log(`[BLSCheckpoint] Successfully synced checkpoint for epoch ${epoch}`);

                } catch (error: any) {
                    // Check if the error is due to height not being available
                    if (error?.response?.data?.message?.includes('is not available, lowest height is')) {
                        const match = error.response.data.message.match(/lowest height is (\d+)/);
                        if (match) {
                            lowestAvailableHeight = parseInt(match[1]);
                            console.log(`[BLSCheckpoint] Discovered lowest available height: ${lowestAvailableHeight}`);
                            continue;
                        }
                    }
                    
                    // Log the error but continue with the next epoch
                    console.warn(`[BLSCheckpoint] Failed to sync checkpoint for epoch ${epoch}:`, error.message);
                    continue;
                }

                // Add a small delay to avoid overwhelming the node
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log('[BLSCheckpoint] Historical checkpoint sync completed');
        } catch (error: any) {
            console.error('[BLSCheckpoint] Error during historical checkpoint sync:', error);
            // Don't throw the error, just log it
        }
    }

    public async getCurrentEpoch(network: Network): Promise<number> {
        try {
            const client = this.validatorInfoService.getBabylonClient(network);
            if (!client) {
                throw new Error(`No Babylon client found for network ${network}`);
            }

            // Get current epoch from the node
            const baseUrl = client.getBaseUrl();
            const response = await axios.get(`${baseUrl}/babylon/epoching/v1/current_epoch`, {
                timeout: 5000 // 5 second timeout
            });
            const currentEpoch = parseInt(response.data.current_epoch);

            if (isNaN(currentEpoch)) {
                console.error('[BLSCheckpoint] Failed to get current epoch from node:', response.data);
                throw new Error('Invalid current epoch from node');
            }

            return currentEpoch;
        } catch (error) {
            console.error('[BLSCheckpoint] Error getting current epoch:', error);
            throw error;
        }
    }
} 