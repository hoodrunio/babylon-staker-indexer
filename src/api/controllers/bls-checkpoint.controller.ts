import { Request, Response } from 'express';
import { Network } from '../../types/finality';
import { BLSCheckpoint } from '../../database/models/BLSCheckpoint';
import { BLSValidatorSignatures } from '../../database/models/BLSValidatorSignatures';
import { BLSCheckpointService } from '../../services/checkpointing/BLSCheckpointService';

export class BLSCheckpointController {
    private static blsCheckpointService = BLSCheckpointService.getInstance();

    public static async getCheckpointByEpoch(req: Request, res: Response) {
        try {
            const { epoch } = req.params;
            const network = req.network || Network.MAINNET;
            const epochNum = parseInt(epoch);

            if (isNaN(epochNum)) {
                return res.status(400).json({ error: 'Invalid epoch number' });
            }

            const checkpoint = await BLSCheckpoint.findOne({
                epoch_num: epochNum,
                network
            });

            if (!checkpoint) {
                return res.status(404).json({ error: 'Checkpoint not found' });
            }

            const response = {
                epoch_num: checkpoint.epoch_num,
                network: checkpoint.network,
                block_hash: checkpoint.block_hash,
                bitmap: checkpoint.bitmap,
                bls_multi_sig: checkpoint.bls_multi_sig,
                status: checkpoint.status,
                bls_aggr_pk: checkpoint.bls_aggr_pk,
                power_sum: checkpoint.power_sum,
                updated_at: checkpoint.updatedAt,
                timestamp: checkpoint.timestamp
            };

            res.json(response);
        } catch (error) {
            console.error('Error in getCheckpointByEpoch:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public static async getCheckpointsByEpochs(req: Request, res: Response) {
        try {
            const { start_epoch, end_epoch, last } = req.query;
            const network = req.network || Network.TESTNET;
            const limit = 100; // Maximum records per page

            // Get current epoch from service for validation
            const currentEpoch = await BLSCheckpointController.blsCheckpointService.getCurrentEpoch(network);

            let startEpochNum: number | undefined;
            let endEpochNum: number | undefined;

            // Handle 'last' parameter if provided
            if (last) {
                const lastNum = parseInt(last as string);
                if (isNaN(lastNum) || lastNum <= 0) {
                    return res.status(400).json({ error: 'Invalid last parameter. Must be a positive number.' });
                }
                startEpochNum = Math.max(0, currentEpoch - lastNum);
                endEpochNum = currentEpoch;
            } else {
                // Parse start and end epochs if provided
                startEpochNum = start_epoch ? parseInt(start_epoch as string) : undefined;
                endEpochNum = end_epoch ? parseInt(end_epoch as string) : undefined;

                // Validate epoch numbers
                if (startEpochNum !== undefined && (isNaN(startEpochNum) || startEpochNum < 0)) {
                    return res.status(400).json({ error: 'Invalid start_epoch parameter' });
                }
                if (endEpochNum !== undefined && (isNaN(endEpochNum) || endEpochNum < 0)) {
                    return res.status(400).json({ error: 'Invalid end_epoch parameter' });
                }
                if (startEpochNum !== undefined && endEpochNum !== undefined && startEpochNum > endEpochNum) {
                    return res.status(400).json({ error: 'start_epoch cannot be greater than end_epoch' });
                }
            }

            // Build query
            const query: any = { network };
            if (startEpochNum !== undefined || endEpochNum !== undefined) {
                query.epoch_num = {};
                if (startEpochNum !== undefined) query.epoch_num.$gte = startEpochNum;
                if (endEpochNum !== undefined) query.epoch_num.$lte = endEpochNum;
            }

            // Get total count for pagination
            const totalCount = await BLSCheckpoint.countDocuments(query);

            // Get checkpoints with limit and sort by epoch_num in descending order
            const checkpoints = await BLSCheckpoint.find(query)
                .sort({ epoch_num: -1 })
                .limit(limit);

            if (checkpoints.length === 0) {
                return res.status(404).json({ error: 'Checkpoints not found' });
            }

            // Calculate actual range from results
            const actualStartEpoch = Math.min(...checkpoints.map(c => c.epoch_num));
            const actualEndEpoch = Math.max(...checkpoints.map(c => c.epoch_num));

            const response = {
                checkpoints: checkpoints.map(checkpoint => ({
                    epoch_num: checkpoint.epoch_num,
                    network: checkpoint.network,
                    block_hash: checkpoint.block_hash,
                    bitmap: checkpoint.bitmap,
                    bls_multi_sig: checkpoint.bls_multi_sig,
                    status: checkpoint.status,
                    bls_aggr_pk: checkpoint.bls_aggr_pk,
                    power_sum: checkpoint.power_sum,
                    updated_at: checkpoint.updatedAt,
                    timestamp: checkpoint.timestamp
                })),
                pagination: {
                    total_records: totalCount,
                    limit,
                    has_more: totalCount > limit
                },
                range: {
                    requested: {
                        start_epoch: startEpochNum,
                        end_epoch: endEpochNum
                    },
                    actual: {
                        start_epoch: actualStartEpoch,
                        end_epoch: actualEndEpoch
                    }
                }
            };

            res.json(response);
        } catch (error) {
            console.error('Error in getCheckpointsByEpochs:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public static async getValidatorSignaturesByEpoch(req: Request, res: Response) {
        try {
            const { epoch } = req.params;
            const network = req.network || Network.MAINNET;
            const epochNum = parseInt(epoch);

            if (isNaN(epochNum)) {
                return res.status(400).json({ error: 'Invalid epoch number' });
            }

            const validatorSignatures = await BLSValidatorSignatures.findOne({
                epoch_num: epochNum,
                network
            });

            if (!validatorSignatures) {
                return res.status(404).json({ error: 'Validator signatures not found for this epoch' });
            }

            const response = {
                epoch_num: validatorSignatures.epoch_num,
                network: validatorSignatures.network,
                signatures: validatorSignatures.signatures,
                stats: validatorSignatures.stats,
                timestamp: validatorSignatures.timestamp,
                updated_at: validatorSignatures.updatedAt
            };

            res.json(response);
        } catch (error) {
            console.error('Error in getValidatorSignaturesByEpoch:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public static async getLatestEpochStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            
            // Get current epoch from service
            const currentEpoch = await BLSCheckpointController.blsCheckpointService.getCurrentEpoch(network) - 1;
            
            // Get validator signatures for current epoch
            const validatorSignatures = await BLSValidatorSignatures.findOne({
                epoch_num: currentEpoch,
                network
            });

            if (!validatorSignatures) {
                return res.status(404).json({ error: 'Current epoch statistics not found' });
            }

            const response = {
                epoch_num: currentEpoch,
                network,
                stats: validatorSignatures.stats,
                timestamp: Date.now()
            };

            res.json(response);
        } catch (error) {
            console.error('Error in getCurrentEpochStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public static async getValidatorStats(req: Request, res: Response) {
        try {
            const { valoper_address } = req.params;
            const network = req.network || Network.TESTNET;
            const { start_epoch, end_epoch } = req.query;

            // Parse epoch parameters
            const startEpochNum = start_epoch ? parseInt(start_epoch as string) : undefined;
            const endEpochNum = end_epoch ? parseInt(end_epoch as string) : undefined;

            // Validate epoch parameters if provided
            if (start_epoch && isNaN(startEpochNum!)) {
                return res.status(400).json({ error: 'Invalid start_epoch parameter' });
            }
            if (end_epoch && isNaN(endEpochNum!)) {
                return res.status(400).json({ error: 'Invalid end_epoch parameter' });
            }

            // Build query
            const query: any = {
                network,
                'signatures.valoper_address': valoper_address
            };

            // Add epoch range if provided
            if (startEpochNum !== undefined || endEpochNum !== undefined) {
                query.epoch_num = {};
                if (startEpochNum !== undefined) {
                    query.epoch_num.$gte = startEpochNum;
                }
                if (endEpochNum !== undefined) {
                    query.epoch_num.$lte = endEpochNum;
                }
            }

            // Get validator signatures
            const validatorSignatures = await BLSValidatorSignatures.find(query).sort({ epoch_num: -1 });

            if (validatorSignatures.length === 0) {
                // Let's check if the validator exists in any records
                const anyRecord = await BLSValidatorSignatures.findOne({
                    'signatures.valoper_address': valoper_address
                });

                if (!anyRecord) {
                    return res.status(404).json({ 
                        error: 'No validator signatures found',
                        details: 'Validator address not found in any records'
                    });
                }

                return res.status(404).json({ 
                    error: 'No validator signatures found',
                    details: 'No signatures found for the specified parameters'
                });
            }

            // Calculate overall statistics
            let totalSigned = 0;
            let totalPower = 0;
            let signedPower = 0;
            const epochStats: any[] = [];

            validatorSignatures.forEach(epochData => {
                const validatorData = epochData.signatures.find(sig => sig.valoper_address === valoper_address);
                if (validatorData) {
                    const power = parseInt(validatorData.validator_power);
                    totalPower += power;
                    if (validatorData.signed) {
                        totalSigned++;
                        signedPower += power;
                    }

                    epochStats.push({
                        epoch_num: epochData.epoch_num,
                        signed: validatorData.signed,
                        power: validatorData.validator_power,
                        moniker: validatorData.moniker,
                        valoper_address: validatorData.valoper_address
                    });
                }
            });

            const response = {
                valoper_address,
                network,
                overall_stats: {
                    total_epochs: validatorSignatures.length,
                    signed_epochs: totalSigned,
                    missed_epochs: validatorSignatures.length - totalSigned,
                    participation_rate: ((totalSigned / validatorSignatures.length) * 100).toFixed(2) + '%',
                    total_power: totalPower.toString(),
                    signed_power: signedPower.toString(),
                    power_participation_rate: ((signedPower / totalPower) * 100).toFixed(2) + '%'
                },
                epoch_stats: epochStats,
                time_range: {
                    start_epoch: Math.min(...validatorSignatures.map(v => v.epoch_num)),
                    end_epoch: Math.max(...validatorSignatures.map(v => v.epoch_num))
                },
                timestamp: Date.now()
            };

            res.json(response);
        } catch (error) {
            console.error('Error in getValidatorStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 