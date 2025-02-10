import { Network } from '../../types/finality';
import { BLSCheckpoint } from '../../database/models/BLSCheckpoint';
import { BLSValidatorSignatures } from '../../database/models/BLSValidatorSignatures';
import { ValidatorInfoService } from '../validator/ValidatorInfoService';
import axios from 'axios';
import { convertBase64AddressToHex } from '../../utils/util';

export class BLSCheckpointFetcher {
    private static instance: BLSCheckpointFetcher | null = null;
    private validatorInfoService: ValidatorInfoService;

    private constructor() {
        this.validatorInfoService = ValidatorInfoService.getInstance();
    }

    public static getInstance(): BLSCheckpointFetcher {
        if (!BLSCheckpointFetcher.instance) {
            BLSCheckpointFetcher.instance = new BLSCheckpointFetcher();
        }
        return BLSCheckpointFetcher.instance;
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

                        // Process validator votes if available
                        if (msg.extended_commit_info?.votes) {
                            await this.processValidatorVotes(msg.extended_commit_info.votes, checkpoint.epoch_num, network);
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

    private async processValidatorVotes(votes: any[], epochNum: number, network: Network): Promise<void> {
        try {
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

            // Calculate statistics
            const signedValidators = allValidators.filter(v => v.signed);
            const unsignedValidators = allValidators.filter(v => !v.signed);
            const totalPower = allValidators.reduce((sum, v) => sum + parseInt(v.validator_power), 0);
            const signedPower = signedValidators.reduce((sum, v) => sum + parseInt(v.validator_power), 0);
            const unsignedPower = totalPower - signedPower;
            const byCount = ((signedValidators.length / allValidators.length) * 100).toFixed(2) + '%';
            const byPower = ((signedPower / totalPower) * 100).toFixed(2) + '%';

            // Store all validator signatures and stats
            await BLSValidatorSignatures.findOneAndUpdate(
                {
                    epoch_num: epochNum,
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
                        by_power: byPower,
                        signed_validators: signedValidators.length,
                        unsigned_validators: unsignedValidators.length
                    }
                },
                { upsert: true, new: true }
            );

            // Enhanced logging with both signed and unsigned validator details
            console.log(`[BLSCheckpoint] Processed validator votes for epoch ${epochNum}:`, {
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
        } catch (error) {
            console.error(`[BLSCheckpoint] Error processing validator votes:`, error);
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
            const response = await axios.get(`${baseUrl}/babylon/epoching/v1/current_epoch`, {
                timeout: 5000
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

    public async syncHistoricalCheckpoints(network: Network): Promise<void> {
        try {
            const currentEpoch = await this.getCurrentEpoch(network);
            console.log(`[BLSCheckpoint] Starting historical sync from epoch ${currentEpoch - 1}`);

            let lowestAvailableHeight: number | null = null;

            for (let epoch = currentEpoch - 1; epoch >= 0; epoch--) {
                try {
                    if (lowestAvailableHeight !== null) {
                        const epochHeight = await this.calculateBlockHeightForEpoch(epoch, network);
                        if (epochHeight < lowestAvailableHeight) {
                            console.log(`[BLSCheckpoint] Stopping sync as epoch ${epoch} (height ${epochHeight}) is below lowest available height ${lowestAvailableHeight}`);
                            break;
                        }
                    }

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
                    if (error?.response?.data?.message?.includes('is not available, lowest height is')) {
                        const match = error.response.data.message.match(/lowest height is (\d+)/);
                        if (match) {
                            lowestAvailableHeight = parseInt(match[1]);
                            console.log(`[BLSCheckpoint] Discovered lowest available height: ${lowestAvailableHeight}`);
                            continue;
                        }
                    }
                    
                    console.warn(`[BLSCheckpoint] Failed to sync checkpoint for epoch ${epoch}:`, error.message);
                    continue;
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log('[BLSCheckpoint] Historical checkpoint sync completed');
        } catch (error: any) {
            console.error('[BLSCheckpoint] Error during historical checkpoint sync:', error);
        }
    }
} 