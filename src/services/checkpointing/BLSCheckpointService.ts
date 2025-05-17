import { BLSValidatorSignature } from '../../database/models/BLSValidatorSignature';
import { BLSCheckpoint } from '../../database/models/BLSCheckpoint';
import { ValidatorInfoService } from '../validator/ValidatorInfoService';
import { BLSCheckpointFetcher } from './BLSCheckpointFetcher';
import { BLSCheckpointHandler } from './BLSCheckpointHandler';
import { logger } from '../../utils/logger';
import { BabylonClient } from '../../clients/BabylonClient';

export class BLSCheckpointService {
    private static instance: BLSCheckpointService | null = null;
    private validatorInfoService: ValidatorInfoService;
    private checkpointFetcher: BLSCheckpointFetcher;
    private checkpointHandler: BLSCheckpointHandler;
    private babylonClient: BabylonClient;

    private constructor() {
        this.validatorInfoService = ValidatorInfoService.getInstance();
        this.checkpointFetcher = BLSCheckpointFetcher.getInstance();
        this.checkpointHandler = BLSCheckpointHandler.getInstance();
        this.babylonClient = BabylonClient.getInstance();

        // If CHECKPOINT_SYNC is true, synchronize historical checkpoints
        if (process.env.CHECKPOINT_SYNC === 'true') {
            logger.info('[BLSCheckpoint] Full sync enabled, starting historical checkpoint sync');
            this.initializeHistoricalSync();
        }
    }

    public static getInstance(): BLSCheckpointService {
        if (!BLSCheckpointService.instance) {
            BLSCheckpointService.instance = new BLSCheckpointService();
        }
        return BLSCheckpointService.instance;
    }

    public async handleCheckpoint(event: any): Promise<void> {
        return this.checkpointHandler.handleCheckpoint(event);
    }

    public async getCheckpointByEpoch(epochNum: number): Promise<any> {
        try {
            const checkpoint = await BLSCheckpoint.findOne({
                epoch_num: epochNum
            });

            if (checkpoint) {
                const validatorSignatures = await BLSValidatorSignature.find({
                    epoch_num: epochNum
                });

                // Enrich validator signatures with validator info
                const enrichedSignatures = await Promise.all(
                    validatorSignatures.map(async (sig) => {
                        const validatorInfo = await this.validatorInfoService.getValidatorByHexAddress(sig.validator_address);
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
            logger.error('Error getting checkpoint:', error);
            throw error;
        }
    }
    public async fetchCheckpointForEpoch(epochNum: number): Promise<void> {
        return this.checkpointFetcher.fetchCheckpointForEpoch(epochNum);
    }

    public async syncHistoricalCheckpoints(batchSize?: number): Promise<void> {
        return this.checkpointFetcher.syncHistoricalCheckpoints(batchSize);
    }

    public async getCurrentEpoch(): Promise<number> {
        return this.checkpointFetcher.getCurrentEpoch();
    }

    private async initializeHistoricalSync() {
        try {
            logger.info(`[BLSCheckpoint] Starting historical sync`);
            await this.syncHistoricalCheckpoints();
        } catch (error) {
            logger.error('[BLSCheckpoint] Error initializing historical sync:', error);
        }
    }
} 