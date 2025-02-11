import { BLSValidatorSignature } from '../../database/models/BLSValidatorSignature';
import { BLSCheckpoint } from '../../database/models/BLSCheckpoint';
import { ValidatorInfoService } from '../validator/ValidatorInfoService';
import { Network } from '../../types/finality';
import { BLSCheckpointFetcher } from './BLSCheckpointFetcher';
import { BLSCheckpointHandler } from './BLSCheckpointHandler';

export class BLSCheckpointService {
    private static instance: BLSCheckpointService | null = null;
    private validatorInfoService: ValidatorInfoService;
    private checkpointFetcher: BLSCheckpointFetcher;
    private checkpointHandler: BLSCheckpointHandler;

    private constructor() {
        this.validatorInfoService = ValidatorInfoService.getInstance();
        this.checkpointFetcher = BLSCheckpointFetcher.getInstance();
        this.checkpointHandler = BLSCheckpointHandler.getInstance();

        // ENABLE_FULL_SYNC true ise geçmiş checkpointleri senkronize et
        if (process.env.ENABLE_FULL_SYNC === 'true') {
            console.log('[BLSCheckpoint] Full sync enabled, starting historical checkpoint sync');
            this.initializeHistoricalSync();
        }
    }

    public static getInstance(): BLSCheckpointService {
        if (!BLSCheckpointService.instance) {
            BLSCheckpointService.instance = new BLSCheckpointService();
        }
        return BLSCheckpointService.instance;
    }

    public async handleCheckpoint(event: any, network: Network): Promise<void> {
        return this.checkpointHandler.handleCheckpoint(event, network);
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
    public async fetchCheckpointForEpoch(epochNum: number, network: Network): Promise<void> {
        return this.checkpointFetcher.fetchCheckpointForEpoch(epochNum, network);
    }

    public async syncHistoricalCheckpoints(network: Network): Promise<void> {
        return this.checkpointFetcher.syncHistoricalCheckpoints(network);
    }

    public async getCurrentEpoch(network: Network): Promise<number> {
        return this.checkpointFetcher.getCurrentEpoch(network);
    }

    private async initializeHistoricalSync() {
        try {
            // Her network için senkronizasyonu başlat
            const networks = [Network.MAINNET, Network.TESTNET];
            
            for (const network of networks) {
                try {
                    const client = this.validatorInfoService.getBabylonClient(network);
                    if (client) {
                        console.log(`[BLSCheckpoint] Starting historical sync for ${network}`);
                        await this.syncHistoricalCheckpoints(network);
                    }
                } catch (error) {
                    console.error(`[BLSCheckpoint] Error syncing historical checkpoints for ${network}:`, error);
                }
            }
        } catch (error) {
            console.error('[BLSCheckpoint] Error initializing historical sync:', error);
        }
    }
} 