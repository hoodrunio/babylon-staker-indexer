import { Network } from '../../types/finality';
import { BLSCheckpoint } from '../../database/models/BLSCheckpoint';
import { BLSValidatorSignatures } from '../../database/models/BLSValidatorSignatures';
import { ValidatorInfoService } from '../validator/ValidatorInfoService';
import axios from 'axios';
import { convertBase64AddressToHex } from '../../utils/util';
import { logger } from '../../utils/logger';


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
            
            logger.info(`[BLSCheckpoint] Calculated block height ${targetHeight} for epoch ${epochNum}`);
            return targetHeight;
        } catch (error) {
            logger.error(`[BLSCheckpoint] Error calculating block height for epoch ${epochNum}:`, error);
            throw error;
        }
    }

    public async fetchCheckpointForEpoch(epochNum: number, network: Network): Promise<void> {
        const MAX_RETRIES = 3;
        const INITIAL_RETRY_DELAY = 2000; // 2 seconds
        const MAX_RETRY_DELAY = 10000; // 10 seconds
        let retryCount = 0;

        while (retryCount < MAX_RETRIES) {
            try {
                const height = await this.calculateBlockHeightForEpoch(epochNum, network);
                await this.fetchCheckpointFromHeight(height, network);
                // If successful, exit the loop
                return;
            } catch (error: any) {
                const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
                
                // Check if the error is about invalid height (future block)
                const isHeightError = 
                    errorMessage.includes('invalid height') || 
                    errorMessage.includes('height must not be less than') ||
                    errorMessage.includes('must be less than or equal to the current blockchain height');
                
                if (isHeightError) {
                    logger.warn(`[BLSCheckpoint] Future block error when fetching checkpoint for epoch ${epochNum}. Will retry in a moment.`);
                    
                    // If it's a height error, retry after a delay
                    retryCount++;
                    
                    // If we've hit the max retries, throw the error
                    if (retryCount >= MAX_RETRIES) {
                        logger.error(`[BLSCheckpoint] Max retries (${MAX_RETRIES}) exceeded for epoch ${epochNum}`);
                        throw error;
                    }
                    
                    // Calculate backoff delay with exponential increase
                    const retryDelay = Math.min(
                        MAX_RETRY_DELAY,
                        INITIAL_RETRY_DELAY * Math.pow(2, retryCount)
                    );
                    
                    logger.info(`[BLSCheckpoint] Retrying (${retryCount}/${MAX_RETRIES}) in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    
                    // Also rotate to the next node before retrying
                    const client = this.validatorInfoService.getBabylonClient(network);
                    if (client) {
                        const newUrl = client.rotateNodeUrl();
                        logger.info(`[BLSCheckpoint] Rotated to new node: ${newUrl}`);
                    }
                    
                    // Continue to the next iteration
                    continue;
                }
                
                // For other errors, log and throw
                logger.error(`[BLSCheckpoint] Error fetching checkpoint for epoch ${epochNum}: ${errorMessage}`);
                throw error;
            }
        }
    }

    private async fetchCheckpointFromHeight(height: number, network: Network): Promise<void> {
        const MAX_RETRIES = 3;
        const INITIAL_RETRY_DELAY = 2000; // 2 seconds
        const MAX_RETRY_DELAY = 10000; // 10 seconds
        let retryCount = 0;

        while (retryCount < MAX_RETRIES) {
            try {
                const client = this.validatorInfoService.getBabylonClient(network);
                if (!client) {
                    throw new Error(`No Babylon client found for network ${network}`);
                }

                const baseUrl = client.getBaseUrl();
                logger.info(`[BLSCheckpoint] Fetching checkpoint from height ${height} on ${network}`);

                const timestamp = await this.getTimestampForHeight(height, network);
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
                    logger.info(`[BLSCheckpoint] No checkpoint transactions found at height ${height}`);
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
                                block_hash: convertBase64AddressToHex(msg.ckpt.ckpt.block_hash),
                                bitmap: msg.ckpt.ckpt.bitmap,
                                bls_multi_sig: msg.ckpt.ckpt.bls_multi_sig,
                                status: msg.ckpt.status,
                                bls_aggr_pk: msg.ckpt.bls_aggr_pk,
                                power_sum: msg.ckpt.power_sum,
                                network,
                                lifecycle: msg.ckpt.lifecycle || [],
                                timestamp: timestamp
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
                                await this.processValidatorVotes(msg.extended_commit_info.votes, checkpoint.epoch_num, network, timestamp);
                            }

                        } catch (error: any) {
                            logger.error(`[BLSCheckpoint] Error processing checkpoint message: ${error.message || 'Unknown error'}`);
                            continue;
                        }
                    }
                }

                logger.info(`[BLSCheckpoint] Successfully processed ${checkpointTxs.length} checkpoint transaction(s) from height ${height}`);
                // If successful, exit the retry loop
                return;
            } catch (error: any) {
                const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
                
                // Check if the error is about invalid height (future block)
                const isHeightError = 
                    errorMessage.includes('invalid height') || 
                    errorMessage.includes('height must not be less than') ||
                    errorMessage.includes('must be less than or equal to the current blockchain height');
                
                // Check for HTTP 500 error that could be related to node sync issues
                const isServerError = error.response?.status === 500;
                
                if (isHeightError || isServerError) {
                    logger.warn(`[BLSCheckpoint] Error fetching checkpoint from height ${height}: ${errorMessage}. Will retry with another node.`);
                    
                    // Increment retry counter
                    retryCount++;
                    
                    // If we've hit the max retries, throw the error
                    if (retryCount >= MAX_RETRIES) {
                        logger.error(`[BLSCheckpoint] Max retries (${MAX_RETRIES}) exceeded for height ${height}`);
                        throw error;
                    }
                    
                    // Calculate backoff delay with exponential increase
                    const retryDelay = Math.min(
                        MAX_RETRY_DELAY,
                        INITIAL_RETRY_DELAY * Math.pow(2, retryCount)
                    );
                    
                    logger.info(`[BLSCheckpoint] Retrying (${retryCount}/${MAX_RETRIES}) in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    
                    // Rotate to the next node before retrying
                    const client = this.validatorInfoService.getBabylonClient(network);
                    if (client) {
                        const newUrl = client.rotateNodeUrl();
                        logger.info(`[BLSCheckpoint] Rotated to new node: ${newUrl}`);
                    }
                    
                    // Continue to the next iteration
                    continue;
                }
                
                // For other errors, log and throw
                logger.error(`[BLSCheckpoint] Error fetching checkpoint from height ${height}: ${errorMessage}`);
                throw error;
            }
        }
    }

    private async processValidatorVotes(votes: any[], epochNum: number, network: Network, timestamp: number): Promise<void> {
        try {
            // First, ensure all validators are in the database
            const validatorAddresses = votes.map(vote => convertBase64AddressToHex(vote.validator.address));
            
            // Wait for validator info service to be initialized
            await this.validatorInfoService.waitForInitialization();
            
            let validatorInfos = await Promise.all(
                validatorAddresses.map(hexAddress => 
                    this.validatorInfoService.getValidatorByHexAddress(hexAddress, network)
                )
            );

            // Check if any validator info is missing
            const missingValidators = validatorAddresses.filter((hexAddress, index) => !validatorInfos[index]);
            if (missingValidators.length > 0) {
                logger.warn(`[BLSCheckpoint] Missing validator info for addresses: ${missingValidators.join(', ')}`);
                logger.warn('[BLSCheckpoint] Waiting for next validator info update...');
                
                // Wait for the next update cycle
                await this.validatorInfoService.waitForNextUpdate();
                
                // Retry getting validator info after update
                validatorInfos = await Promise.all(
                    validatorAddresses.map(hexAddress => 
                        this.validatorInfoService.getValidatorByHexAddress(hexAddress, network)
                    )
                );
                
                // Check if we still have missing validators after update
                const stillMissingValidators = validatorAddresses.filter((hexAddress, index) => !validatorInfos[index]);
                if (stillMissingValidators.length > 0) {
                    logger.error(`[BLSCheckpoint] Still missing validator info for addresses: ${stillMissingValidators.join(', ')}`);
                    throw new Error('Validator info not yet available for all validators');
                }
            }

            const allValidators = await Promise.all(
                votes.map(async (vote: any, index: number) => {
                    const hexAddress = convertBase64AddressToHex(vote.validator.address);
                    const validatorInfo = validatorInfos[index];
                    const signed = vote.block_id_flag === 'BLOCK_ID_FLAG_COMMIT';
                    
                    return {
                        validator_address: validatorInfo.valcons_address,
                        hex_address: hexAddress,
                        validator_power: vote.validator.power,
                        signed,
                        vote_extension: signed ? vote.vote_extension : undefined,
                        extension_signature: signed ? vote.extension_signature : undefined,
                        moniker: validatorInfo.moniker,
                        valoper_address: validatorInfo.valoper_address,
                        timestamp: timestamp
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
                    },
                    timestamp: timestamp,
                    updatedAt: new Date(timestamp * 1000)
                },
                { upsert: true, new: true, timestamps: false }
            );

            logger.info(`[BLSCheckpoint] Processed validator votes for epoch ${epochNum}`);
        } catch (error) {
            logger.error(`[BLSCheckpoint] Error processing validator votes:`, error);
            throw error;
        }
    }

    public async getCurrentEpoch(network: Network): Promise<number> {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000; // 2 seconds
        let retryCount = 0;

        while (retryCount < MAX_RETRIES) {
            try {
                const client = this.validatorInfoService.getBabylonClient(network);
                if (!client) {
                    throw new Error(`No Babylon client found for network ${network}`);
                }

                const baseUrl = client.getBaseUrl();
                const response = await axios.get(`${baseUrl}/babylon/epoching/v1/current_epoch`, {
                    timeout: 10000 // Increased timeout to 10 seconds
                });
                const currentEpoch = parseInt(response.data.current_epoch);

                if (isNaN(currentEpoch)) {
                    logger.error('[BLSCheckpoint] Failed to get current epoch from node:', response.data);
                    throw new Error('Invalid current epoch from node');
                }

                return currentEpoch;
            } catch (error) {
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                    logger.info(`[BLSCheckpoint] Retry ${retryCount}/${MAX_RETRIES} getting current epoch after ${RETRY_DELAY}ms`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                } else {
                    logger.error('[BLSCheckpoint] Error getting current epoch after all retries:', error);
                    throw error;
                }
            }
        }

        throw new Error('Failed to get current epoch after max retries');
    }

    public async getTimestampForHeight(height: number, network: Network): Promise<number> {
        try {
            const client = this.validatorInfoService.getBabylonClient(network);
            if (!client) {
                throw new Error(`No Babylon client found for network ${network}`);
            }
            const baseRpcUrl = client.getRpcUrl();
            const response = await axios.get(`${baseRpcUrl}/block?height=${height}`);
            const timeStr = response.data.result.block.header.time;
            
            // Remove nanoseconds part and parse ISO timestamp
            const cleanTimeStr = timeStr.split('.')[0] + 'Z';
            const timestamp = new Date(cleanTimeStr).getTime();
            
            if (isNaN(timestamp)) {
                logger.error(`[BLSCheckpoint] Invalid timestamp format received:`, timeStr);
                throw new Error('Invalid timestamp from node');
            }
            
            // Convert to seconds
            return Math.floor(timestamp / 1000);
        } catch (error: any) {
            // Check if error is due to pruned height
            if (error?.response?.data?.error?.data?.includes('is not available, lowest height is')) {
                const match = error.response.data.error.data.match(/lowest height is (\d+)/);
                if (match) {
                    const lowestHeight = parseInt(match[1]);
                    throw new Error(`height ${height} is not available, lowest height is ${lowestHeight}`);
                }
            }
            throw error;
        }
    }

    public async syncHistoricalCheckpoints(network: Network, batchSize: number = 10): Promise<void> {
        try {
            const currentEpoch = await this.getCurrentEpoch(network);
            logger.info(`[BLSCheckpoint] Starting historical sync from epoch ${currentEpoch - 1}`);

            let lowestAvailableHeight: number | null = null;
            let consecutiveErrors = 0;
            const MAX_CONSECUTIVE_ERRORS = 5;
            const MAX_RETRIES = 3;
            const RETRY_DELAY = 2000; // 2 seconds

            // Create array of epoch numbers to process
            const epochsToProcess: number[] = [];
            for (let epoch = currentEpoch - 1; epoch >= 0; epoch--) {
                const existingCheckpoint = await BLSCheckpoint.findOne({
                    epoch_num: epoch,
                    network
                });

                if (!existingCheckpoint) {
                    epochsToProcess.push(epoch);
                }
            }

            logger.info(`[BLSCheckpoint] Found ${epochsToProcess.length} epochs to process`);

            // Process epochs in batches
            for (let i = 0; i < epochsToProcess.length; i += batchSize) {
                const batch = epochsToProcess.slice(i, i + batchSize);
                logger.info(`[BLSCheckpoint] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(epochsToProcess.length/batchSize)}`);

                // Process each epoch in the batch sequentially
                for (const epoch of batch) {
                    try {
                        if (lowestAvailableHeight !== null) {
                            const epochHeight = await this.calculateBlockHeightForEpoch(epoch, network);
                            if (epochHeight < lowestAvailableHeight) {
                                logger.info(`[BLSCheckpoint] Historical sync stopped at epoch ${epoch} (height ${epochHeight} is below lowest available height ${lowestAvailableHeight})`);
                                return;
                            }
                        }

                        let success = false;
                        let retryCount = 0;

                        while (!success && retryCount < MAX_RETRIES) {
                            try {
                                await this.fetchCheckpointForEpoch(epoch, network);
                                logger.info(`[BLSCheckpoint] Successfully synced checkpoint for epoch ${epoch}`);
                                success = true;
                                consecutiveErrors = 0;
                            } catch (retryError: any) {
                                retryCount++;
                                const errorMessage = retryError.message || '';
                                if (errorMessage.includes('is not available, lowest height is')) {
                                    const match = errorMessage.match(/lowest height is (\d+)/);
                                    if (match) {
                                        lowestAvailableHeight = parseInt(match[1]);
                                        logger.info(`[BLSCheckpoint] Node pruning detected - lowest available height: ${lowestAvailableHeight}`);
                                        return;
                                    }
                                }
                                if (retryCount < MAX_RETRIES) {
                                    logger.info(`[BLSCheckpoint] Retry ${retryCount}/${MAX_RETRIES} for epoch ${epoch} after ${RETRY_DELAY}ms`);
                                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                                }
                            }
                        }

                        if (!success) {
                            throw new Error(`Failed to sync checkpoint after ${MAX_RETRIES} retries`);
                        }

                    } catch (error: any) {
                        if (error?.response?.data?.message?.includes('is not available, lowest height is')) {
                            const match = error.response.data.message.match(/lowest height is (\d+)/);
                            if (match) {
                                lowestAvailableHeight = parseInt(match[1]);
                                logger.info(`[BLSCheckpoint] Node pruning detected - lowest available height: ${lowestAvailableHeight}`);
                                return;
                            }
                        }
                        
                        consecutiveErrors++;
                        
                        if (error?.response?.status === 500) {
                            logger.warn(`[BLSCheckpoint] Server error (500) for epoch ${epoch}:`, error.response?.data?.message || 'Unknown server error');
                        } else {
                            logger.warn(`[BLSCheckpoint] Failed to sync checkpoint for epoch ${epoch}:`, error.message || 'Unknown error');
                        }

                        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                            logger.error(`[BLSCheckpoint] Stopping historical sync after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
                            return;
                        }
                    }

                    // Add small delay between epochs in the same batch
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                // Add delay between batches
                if (i + batchSize < epochsToProcess.length) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            logger.info('[BLSCheckpoint] Historical checkpoint sync completed');
        } catch (error: any) {
            logger.error('[BLSCheckpoint] Error during historical checkpoint sync:', error.message || 'Unknown error');
            throw error;
        }
    }
} 