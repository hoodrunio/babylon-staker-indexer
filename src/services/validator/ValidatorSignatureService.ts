import { Network } from '../../types/finality';
import { ValidatorSignature, IValidatorSignatureDocument } from '../../database/models/ValidatorSignature';
import { ValidatorInfoService } from './ValidatorInfoService';

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
    private readonly RECENT_BLOCKS_LIMIT = 100; // Son 100 blok detayı
    private readonly SIGNATURE_PERFORMANCE_WINDOW = 10000; // Son 10k blok için performans

    private constructor() {
        this.validatorInfoService = ValidatorInfoService.getInstance();
    }

    public static getInstance(): ValidatorSignatureService {
        if (!ValidatorSignatureService.instance) {
            ValidatorSignatureService.instance = new ValidatorSignatureService();
        }
        return ValidatorSignatureService.instance;
    }

    public async getLastProcessedBlock(network: Network): Promise<number> {
        const lastSignature = await ValidatorSignature.findOne({ network: network.toLowerCase() })
            .sort({ lastSignedBlock: -1 })
            .select('lastSignedBlock')
            .lean();

        return lastSignature?.lastSignedBlock || 0;
    }

    public async handleNewBlock(blockData: BlockData, network: Network): Promise<void> {
        try {
            const height = parseInt(blockData.block.header.height);
            const timestamp = new Date(blockData.block.header.time);
            const round = blockData.block.last_commit.round;

            // Aktif validatörleri ve imzalarını al
            const blockSignatures = new Map(
                blockData.block.last_commit.signatures
                    .filter(sig => sig.validator_address)
                    .map(sig => [sig.validator_address, sig])
            );

            // Tüm validatörleri getir (aktif ve inaktif)
            const allValidators = await ValidatorSignature.find({
                network: network.toLowerCase()
            }).select('validatorAddress').lean();

            // Mevcut blokta aktif olan validatörleri işaretle
            const allValidatorAddresses = new Set([
                ...allValidators.map(v => v.validatorAddress),
                ...blockSignatures.keys()
            ]);

            // Fetch all validator info in bulk
            const validatorInfoPromises = Array.from(blockSignatures.keys()).map(address => 
                this.validatorInfoService.getValidatorByHexAddress(address, network)
            );
            const validatorInfos = await Promise.all(validatorInfoPromises);
            const validatorInfoMap = new Map(
                validatorInfos.map((info, index) => [
                    Array.from(blockSignatures.keys())[index],
                    info
                ])
            );

            // İlk olarak, mevcut olmayan validatorları oluştur
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

            // Tüm validatörleri güncelle (aktif ve inaktif)
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

            // İmza oranlarını güncelle
            const validators = await ValidatorSignature.find({
                network: network.toLowerCase(),
                validatorAddress: { $in: Array.from(allValidatorAddresses) }
            });

            const rateUpdateOps = validators.map(validator => {
                // Son 100 blok için ardışık imza/kaçırma sayılarını hesapla
                const recentBlocks = validator.recentBlocks || [];
                const consecutiveSigned = recentBlocks.length > 0 && recentBlocks[recentBlocks.length - 1].signed
                    ? (validator.consecutiveSigned || 0) + 1
                    : 0;
                const consecutiveMissed = recentBlocks.length > 0 && !recentBlocks[recentBlocks.length - 1].signed
                    ? (validator.consecutiveMissed || 0) + 1
                    : 0;

                // Performans penceresindeki blok sayısını kontrol et
                const totalBlocksInWindow = Math.min(
                    validator.totalBlocksInWindow || 0,
                    this.SIGNATURE_PERFORMANCE_WINDOW
                );

                // Genel imza oranını hesapla
                let signatureRate = 0;
                if (totalBlocksInWindow < 100 && recentBlocks.length > 0) {
                    const recentSignedBlocks = recentBlocks.filter(b => b.signed).length;
                    signatureRate = (recentSignedBlocks / recentBlocks.length) * 100;
                } else if (totalBlocksInWindow >= 100) {
                    signatureRate = totalBlocksInWindow > 0
                        ? (validator.totalSignedBlocks / totalBlocksInWindow) * 100
                        : 0;
                }

                // totalSignedBlocks sayısını da kontrol et ve gerekirse düzelt
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

            console.log(`[ValidatorSignature] Processed signatures for block ${height} on ${network}`);
        } catch (error) {
            console.error('[ValidatorSignature] Error processing block signatures:', error);
            throw error;
        }
    }

    public async getValidatorSignatures(
        network: Network,
        validatorAddress?: string,
        validatorOperatorAddress?: string,
        minSignatureRate?: number
    ): Promise<IValidatorSignatureDocument[]> {
        const query: any = { network: network.toLowerCase() };

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
        network: Network,
        consensusAddress: string
    ): Promise<IValidatorSignatureDocument | null> {
        return await ValidatorSignature.findOne({
            network: network.toLowerCase(),
            validatorConsensusAddress: consensusAddress
        }).lean();
    }

    public async getValidatorSignaturesByValoperAddress(
        network: Network,
        valoperAddress: string
    ): Promise<IValidatorSignatureDocument | null> {
        return await ValidatorSignature.findOne({
            network: network.toLowerCase(),
            validatorOperatorAddress: valoperAddress
        }).lean();
    }

    public async getValidatorMissedBlocks(
        network: Network,
        validatorAddress: string,
        startHeight?: number,
        endHeight?: number
    ): Promise<Array<{ blockHeight: number; timestamp: Date }>> {
        const validator = await ValidatorSignature.findByAddress(network.toLowerCase(), validatorAddress);

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