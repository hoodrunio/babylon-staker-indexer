import { ValidatorSignature, IValidatorSignatureDocument } from '../../database/models/ValidatorSignature';
import { ValidatorInfoService } from './ValidatorInfoService';
import { logger } from '../../utils/logger';
import { BabylonClient } from '../../clients/BabylonClient';

interface TendermintSignature {
    validator_address: string;
    signature: string;
}

interface BlockData {
    block: {
        header: {
            height: string;
            time: string;
        };
        last_commit: {
            round: number;
            signatures: TendermintSignature[];
        };
    };
}

export class ValidatorSignatureService {
    private static instance: ValidatorSignatureService | null = null;
    private validatorInfoService: ValidatorInfoService;
    private readonly RECENT_BLOCKS_LIMIT = 100; // Last 100 block details
    private readonly SIGNATURE_PERFORMANCE_WINDOW = 10000; // Performance for last 10k blocks
    private babylonClient: BabylonClient;

    private constructor() {
        this.validatorInfoService = ValidatorInfoService.getInstance();
        this.babylonClient = BabylonClient.getInstance();
    }

    public static getInstance(): ValidatorSignatureService {
        if (!ValidatorSignatureService.instance) {
            ValidatorSignatureService.instance = new ValidatorSignatureService();
        }
        return ValidatorSignatureService.instance;
    }

    public async getLastProcessedBlock(): Promise<number> {
        const network = this.babylonClient.getNetwork().toLowerCase();
        const lastSignature = await ValidatorSignature.findOne({ network })
            .sort({ lastSignedBlock: -1 })
            .select('lastSignedBlock')
            .lean();

        return lastSignature?.lastSignedBlock || 0;
    }

    public async handleNewBlock(blockData: BlockData): Promise<void> {
        try {
            const height = parseInt(blockData.block.header.height);
            const timestamp = new Date(blockData.block.header.time);
            const round = blockData.block.last_commit.round;

            // Get active validators and their signatures
            const blockSignatures = new Map(
                blockData.block.last_commit.signatures
                    .filter(sig => sig.validator_address)
                    .map(sig => [sig.validator_address, sig])
            );

            // Get all validators (active and inactive)
            const network = this.babylonClient.getNetwork().toLowerCase();
            const allValidators = await ValidatorSignature.find({
                network
            }).select('validatorAddress').lean();

            // Mark validators active in current block
            const allValidatorAddresses = new Set([
                ...allValidators.map(v => v.validatorAddress),
                ...blockSignatures.keys()
            ]);

            // Fetch all validator info in bulk
            const validatorInfoPromises = Array.from(blockSignatures.keys()).map(address => 
                this.validatorInfoService.getValidatorByHexAddress(address)
            );
            const validatorInfos = await Promise.all(validatorInfoPromises);
            const validatorInfoMap = new Map(
                validatorInfos.map((info, index) => [
                    Array.from(blockSignatures.keys())[index],
                    info
                ])
            );

            // First, create non-existing validators
            const createOps = Array.from(blockSignatures.keys()).map(validatorAddress => {
                const validatorInfo = validatorInfoMap.get(validatorAddress);
                const update: any = {
                    $setOnInsert: {
                        validatorMoniker: validatorInfo?.moniker || null,
                        validatorConsensusAddress: validatorInfo?.valcons_address || null,
                        validatorOperatorAddress: validatorInfo?.valoper_address || null,
                        totalSignedBlocks: 0,
                        totalBlocksInWindow: 0,
                        recentBlocks: []
                    }
                };

                return {
                    updateOne: {
                        filter: {
                            network: network.toLowerCase(),
                            validatorAddress
                        },
                        update,
                        upsert: true
                    }
                } as any;
            });

            if (createOps.length > 0) {
                await ValidatorSignature.bulkWrite(createOps as any[], { ordered: false });
            }

            // Update all validators (active and inactive)
            const updateOps = Array.from(allValidatorAddresses).map(validatorAddress => {
                const signature = blockSignatures.get(validatorAddress);
                const isSigned = Boolean(signature?.signature);

                const update: any = {
                    $push: {
                        'recentBlocks': {
                            $each: [{
                                blockHeight: height,
                                signed: isSigned,
                                round,
                                timestamp
                            }],
                            $slice: -this.RECENT_BLOCKS_LIMIT
                        }
                    },
                    $inc: {
                        totalSignedBlocks: isSigned ? 1 : 0,
                        totalBlocksInWindow: 1
                    }
                };

                if (isSigned) {
                    update.$set = {
                        lastSignedBlock: height,
                        lastSignedBlockTime: timestamp
                    };
                }

                return {
                    updateOne: {
                        filter: {
                            network: network.toLowerCase(),
                            validatorAddress
                        },
                        update
                    }
                } as any;
            });

            if (updateOps.length > 0) {
                await ValidatorSignature.bulkWrite(updateOps as any[], { ordered: false });
            }

            // Update signature rates
            const validators = await ValidatorSignature.find({
                network,
                validatorAddress: { $in: Array.from(allValidatorAddresses) }
            });

            const rateUpdateOps = validators.map(validator => {
                // Calculate consecutive signatures/misses for last 100 blocks
                const recentBlocks = validator.recentBlocks || [];
                const consecutiveSigned = recentBlocks.length > 0 && recentBlocks[recentBlocks.length - 1].signed
                    ? (validator.consecutiveSigned || 0) + 1
                    : 0;
                const consecutiveMissed = recentBlocks.length > 0 && !recentBlocks[recentBlocks.length - 1].signed
                    ? (validator.consecutiveMissed || 0) + 1
                    : 0;

                // Check block count in performance window
                const totalBlocksInWindow = Math.min(
                    validator.totalBlocksInWindow || 0,
                    this.SIGNATURE_PERFORMANCE_WINDOW
                );

                // Calculate overall signature rate
                let signatureRate = 0;
                if (totalBlocksInWindow < 100 && recentBlocks.length > 0) {
                    const recentSignedBlocks = recentBlocks.filter(b => b.signed).length;
                    signatureRate = (recentSignedBlocks / recentBlocks.length) * 100;
                } else if (totalBlocksInWindow >= 100) {
                    signatureRate = totalBlocksInWindow > 0
                        ? (validator.totalSignedBlocks / totalBlocksInWindow) * 100
                        : 0;
                }

                // Check totalSignedBlocks count and fix if necessary
                const adjustedTotalSignedBlocks = Math.min(
                    validator.totalSignedBlocks || 0,
                    totalBlocksInWindow
                );

                return {
                    updateOne: {
                        filter: { _id: validator._id },
                        update: {
                            $set: {
                                signatureRate,
                                consecutiveSigned,
                                consecutiveMissed,
                                totalBlocksInWindow,
                                totalSignedBlocks: adjustedTotalSignedBlocks
                            }
                        }
                    }
                } as any;
            });

            if (rateUpdateOps.length > 0) {
                await ValidatorSignature.bulkWrite(rateUpdateOps as any[], { ordered: false });
            }

            logger.info(`[ValidatorSignature] Processed signatures for block ${height} on ${this.babylonClient.getNetwork()}`);
        } catch (error) {
            logger.error('[ValidatorSignature] Error processing block signatures:', error);
            throw error;
        }
    }

    public async getValidatorSignatures(
        validatorAddress?: string,
        validatorOperatorAddress?: string,
        minSignatureRate?: number
    ): Promise<IValidatorSignatureDocument[]> {
        const network = this.babylonClient.getNetwork().toLowerCase();
        const query: any = { network };

        if (validatorAddress) {
            query.validatorAddress = validatorAddress;
        }

        if (validatorOperatorAddress) {
            query.validatorOperatorAddress = validatorOperatorAddress;
        }

        if (minSignatureRate) {
            query.signatureRate = { $gte: minSignatureRate };
        }

        return await ValidatorSignature.find(query)
            .select({
                validatorAddress: 1,
                validatorMoniker: 1,
                validatorConsensusAddress: 1,
                validatorOperatorAddress: 1,
                network: 1,
                totalSignedBlocks: 1,
                totalBlocksInWindow: 1,
                lastSignedBlock: 1,
                lastSignedBlockTime: 1,
                signatureRate: 1,
                consecutiveSigned: 1,
                consecutiveMissed: 1
            })
            .sort({ signatureRate: -1 })
            .lean();
    }

    public async getValidatorSignaturesByConsensusAddress(
        consensusAddress: string
    ): Promise<IValidatorSignatureDocument | null> {
        const network = this.babylonClient.getNetwork().toLowerCase();
        return await ValidatorSignature.findOne({
            network,
            validatorConsensusAddress: consensusAddress
        }).lean();
    }

    public async getValidatorSignaturesByValoperAddress(
        valoperAddress: string
    ): Promise<IValidatorSignatureDocument | null> {
        const network = this.babylonClient.getNetwork().toLowerCase();
        return await ValidatorSignature.findOne({
            network,
            validatorOperatorAddress: valoperAddress
        }).lean();
    }

    public async getValidatorMissedBlocks(
        validatorAddress: string,
        startHeight?: number,
        endHeight?: number
    ): Promise<Array<{ blockHeight: number; timestamp: Date }>> {
        const network = this.babylonClient.getNetwork().toLowerCase();
        const validator = await ValidatorSignature.findByAddress(network, validatorAddress);

        if (!validator) {
            return [];
        }

        let missedBlocks = validator.recentBlocks
            .filter(block => !block.signed)
            .map(block => ({
                blockHeight: block.blockHeight,
                timestamp: block.timestamp
            }));

        if (startHeight) {
            missedBlocks = missedBlocks.filter(block => block.blockHeight >= startHeight);
        }

        if (endHeight) {
            missedBlocks = missedBlocks.filter(block => block.blockHeight <= endHeight);
        }

        return missedBlocks;
    }
}