import { Network } from '../../types/finality';
import { BLSCheckpoint } from '../../database/models/BLSCheckpoint';
import { CheckpointStatusFetcher } from './CheckpointStatusFetcher';
import { convertBase64AddressToHex } from '../../utils/util';

export class CheckpointStatusHandler {
    private static instance: CheckpointStatusHandler | null = null;
    private checkpointStatusFetcher: CheckpointStatusFetcher;

    private constructor() {
        this.checkpointStatusFetcher = CheckpointStatusFetcher.getInstance();

        // ENABLE_FULL_SYNC true ise geçmiş checkpoint'leri senkronize et
        if (process.env.CHECKPOINT_SYNC === 'true') {
            console.log('[CheckpointStatus] Full sync enabled, starting historical checkpoint sync');
            // Asenkron işlemi başlat ama bekleme
            this.initializeHistoricalSync().catch(error => {
                console.error('[CheckpointStatus] Error in historical sync initialization:', error);
            });
        } else {
            console.log('[CheckpointStatus] Full sync disabled, skipping historical checkpoint sync');
        }
    }

    public static getInstance(): CheckpointStatusHandler {
        if (!CheckpointStatusHandler.instance) {
            CheckpointStatusHandler.instance = new CheckpointStatusHandler();
        }
        return CheckpointStatusHandler.instance;
    }

    public async handleNewBlock(blockData: any, network: Network): Promise<void> {
        try {
            const events = blockData?.result?.data?.value?.result_finalize_block?.events;
            const blockHeight = blockData?.result?.data?.value?.block?.header?.height;
            
            console.log(`[CheckpointStatus] Processing block ${blockHeight} with ${events?.length || 0} events`);
            // console.log(`[CheckpointStatus] Full block data:`, JSON.stringify(blockData, null, 2).slice(0, 1000));

            if (!events) {
                console.log(`[CheckpointStatus] No events found in block ${blockHeight}`);
                return;
            }

            // Log checkpoint events found
            const checkpointEvents = events.filter((e: any) => e.type.includes('babylon.checkpointing.v1.EventCheckpoint'));
            if (checkpointEvents.length > 0) {
                console.log(`[CheckpointStatus] Found ${checkpointEvents.length} checkpoint events:`, 
                    checkpointEvents.map((e: any) => e.type));
            }

            // Handle all checkpoint status events
            for (const event of events) {
                switch (event.type) {
                    case 'babylon.checkpointing.v1.EventCheckpointAccumulating':
                        console.log(`[CheckpointStatus] Processing ACCUMULATING event in block ${blockHeight}`);
                        await this.handleAccumulatingEvent(event, network, blockData);
                        break;
                    case 'babylon.checkpointing.v1.EventCheckpointSealed':
                        console.log(`[CheckpointStatus] Skipping SEALED event in block ${blockHeight} (handled by BLSCheckpointHandler)`);
                        break;
                    case 'babylon.checkpointing.v1.EventCheckpointSubmitted':
                    case 'babylon.checkpointing.v1.EventCheckpointConfirmed':
                    case 'babylon.checkpointing.v1.EventCheckpointFinalized':
                        console.log(`[CheckpointStatus] Processing ${event.type.split('.').pop()} event in block ${blockHeight}`);
                        await this.handleStatusUpdateEvent(event, network, blockData);
                        break;
                }
            }
        } catch (error) {
            console.error('[CheckpointStatus] Error handling new block:', error);
        }
    }

    private async handleAccumulatingEvent(event: any, network: Network, blockData: any): Promise<void> {
        try {
            const checkpointAttr = event.attributes?.find((attr: any) => attr.key === 'checkpoint');
            if (!checkpointAttr) {
                console.warn('[CheckpointStatus] Could not find checkpoint attribute');
                return;
            }

            let checkpoint;
            try {
                checkpoint = JSON.parse(checkpointAttr.value);
            } catch (error) {
                console.error('[CheckpointStatus] Error parsing checkpoint JSON:', error);
                return;
            }

            const epochNum = parseInt(checkpoint.ckpt?.epoch_num);
            if (!epochNum) {
                console.warn('[CheckpointStatus] Could not find epoch number in checkpoint data');
                return;
            }

            const blockHeight = parseInt(blockData?.result?.data?.value?.block?.header?.height || '0');
            const now = new Date();

            // Add new lifecycle entry
            const newLifecycleEntry = {
                state: 'CKPT_STATUS_ACCUMULATING',
                block_height: blockHeight,
                block_time: now
            };

            // For accumulating event, create a new checkpoint record if it doesn't exist
            const newCheckpoint = {
                epoch_num: epochNum,
                network,
                block_hash: convertBase64AddressToHex(checkpoint.ckpt?.block_hash || ''),
                bitmap: checkpoint.ckpt?.bitmap || '',
                bls_multi_sig: checkpoint.ckpt?.bls_multi_sig || '',
                status: 'CKPT_STATUS_ACCUMULATING',
                bls_aggr_pk: checkpoint.bls_aggr_pk || '',
                power_sum: checkpoint.power_sum || '0',
                lifecycle: [newLifecycleEntry],
                timestamp: Math.floor(now.getTime() / 1000)
            };

            // Only create if it doesn't exist
            const existingCheckpoint = await BLSCheckpoint.findOne({
                epoch_num: epochNum,
                network
            });

            if (!existingCheckpoint) {
                await BLSCheckpoint.create(newCheckpoint);
                console.log(`[CheckpointStatus] Created new checkpoint for epoch ${epochNum} with status ACCUMULATING`);
            }
        } catch (error) {
            console.error('[CheckpointStatus] Error handling accumulating event:', error);
        }
    }

    private isValidStateTransition(currentState: string, newState: string): boolean {
        type CheckpointState = 'CKPT_STATUS_ACCUMULATING' | 'CKPT_STATUS_SEALED' | 'CKPT_STATUS_SUBMITTED' | 'CKPT_STATUS_CONFIRMED' | 'CKPT_STATUS_FINALIZED';
        
        const stateOrder: Record<CheckpointState, number> = {
            'CKPT_STATUS_ACCUMULATING': 0,
            'CKPT_STATUS_SEALED': 1,
            'CKPT_STATUS_SUBMITTED': 2,
            'CKPT_STATUS_CONFIRMED': 3,
            'CKPT_STATUS_FINALIZED': 4
        };

        // Eğer mevcut durum yoksa (yeni checkpoint), her duruma geçiş yapılabilir
        if (!currentState) return true;

        // Tip kontrolü
        if (!(currentState in stateOrder) || !(newState in stateOrder)) {
            console.warn(`[CheckpointStatus] Invalid state value: ${currentState} -> ${newState}`);
            return false;
        }

        // SEALED durumu BLSCheckpointHandler tarafından işleniyor, bu yüzden bu durumu atlayarak geçiş kontrolü yapıyoruz
        if (currentState === 'CKPT_STATUS_ACCUMULATING' && newState === 'CKPT_STATUS_SUBMITTED') return true;
        if (currentState === 'CKPT_STATUS_SEALED' && newState === 'CKPT_STATUS_SUBMITTED') return true;
        if (currentState === 'CKPT_STATUS_SUBMITTED' && newState === 'CKPT_STATUS_CONFIRMED') return true;
        if (currentState === 'CKPT_STATUS_CONFIRMED' && newState === 'CKPT_STATUS_FINALIZED') return true;

        // Diğer tüm geçişleri reddet
        return false;
    }

    private async handleStatusUpdateEvent(event: any, network: Network, blockData: any): Promise<void> {
        try {
            const checkpointAttr = event.attributes?.find((attr: any) => attr.key === 'checkpoint');
            if (!checkpointAttr) {
                console.warn('[CheckpointStatus] Could not find checkpoint attribute');
                return;
            }

            // console.log(`[CheckpointStatus] Processing checkpoint attribute:`, checkpointAttr.value);

            let checkpoint;
            try {
                checkpoint = JSON.parse(checkpointAttr.value);
                // console.log(`[CheckpointStatus] Parsed checkpoint data:`, checkpoint);
            } catch (error) {
                console.error('[CheckpointStatus] Error parsing checkpoint JSON:', error);
                return;
            }

            const epochNum = parseInt(checkpoint.ckpt?.epoch_num);
            if (!epochNum) {
                console.warn('[CheckpointStatus] Could not find epoch number in checkpoint data');
                return;
            }

            const status = this.getStatusFromEventType(event.type);
            const blockHeight = parseInt(blockData?.result?.data?.value?.block?.header?.height || '0');
            const now = new Date();

            // Mevcut checkpoint'i kontrol et
            const existingCheckpoint = await BLSCheckpoint.findOne({ 
                epoch_num: epochNum,
                network 
            });

            console.log(`[CheckpointStatus] Found existing checkpoint:`, existingCheckpoint ? 'yes' : 'no');
            if (existingCheckpoint) {
                console.log(`[CheckpointStatus] Current status: ${existingCheckpoint.status}, New status: ${status}`);

                // Durum geçiş kontrolü
                if (!this.isValidStateTransition(existingCheckpoint.status, status)) {
                    console.warn(`[CheckpointStatus] Invalid state transition from ${existingCheckpoint.status} to ${status} for epoch ${epochNum}`);
                    return;
                }
            }

            // Add new lifecycle entry
            const newLifecycleEntry = {
                state: status,
                block_height: blockHeight,
                block_time: now
            };

            // Eğer checkpoint bulunamazsa yeni oluştur
            if (!existingCheckpoint) {
                console.log(`[CheckpointStatus] Creating new checkpoint for epoch ${epochNum}`);
                await BLSCheckpoint.create({
                    epoch_num: epochNum,
                    network,
                    block_hash: convertBase64AddressToHex(checkpoint.ckpt?.block_hash || ''),
                    bitmap: checkpoint.ckpt?.bitmap,
                    bls_multi_sig: checkpoint.ckpt?.bls_multi_sig,
                    bls_aggr_pk: checkpoint.bls_aggr_pk,
                    power_sum: checkpoint.power_sum,
                    status,
                    lifecycle: [newLifecycleEntry],
                    timestamp: Math.floor(now.getTime() / 1000)
                });
            } else {
                // Update existing checkpoint
                await BLSCheckpoint.findOneAndUpdate(
                    { 
                        epoch_num: epochNum,
                        network 
                    },
                    { 
                        $set: { 
                            status,
                            block_hash: convertBase64AddressToHex(checkpoint.ckpt?.block_hash || ''),
                            bitmap: checkpoint.ckpt?.bitmap,
                            bls_multi_sig: checkpoint.ckpt?.bls_multi_sig,
                            bls_aggr_pk: checkpoint.bls_aggr_pk,
                            power_sum: checkpoint.power_sum
                        },
                        $push: { lifecycle: newLifecycleEntry }
                    }
                );
            }

            console.log(`[CheckpointStatus] Successfully updated checkpoint ${epochNum} status to ${status}`);
        } catch (error: any) {
            console.error('[CheckpointStatus] Error handling status update event:', error);
            console.error('[CheckpointStatus] Stack trace:', error.stack);
        }
    }

    private getStatusFromEventType(eventType: string): string {
        switch (eventType) {
            case 'babylon.checkpointing.v1.EventCheckpointAccumulating':
                return 'CKPT_STATUS_ACCUMULATING';
            case 'babylon.checkpointing.v1.EventCheckpointSealed':
                return 'CKPT_STATUS_SEALED';
            case 'babylon.checkpointing.v1.EventCheckpointSubmitted':
                return 'CKPT_STATUS_SUBMITTED';
            case 'babylon.checkpointing.v1.EventCheckpointConfirmed':
                return 'CKPT_STATUS_CONFIRMED';
            case 'babylon.checkpointing.v1.EventCheckpointFinalized':
                return 'CKPT_STATUS_FINALIZED';
            default:
                throw new Error(`Unknown event type: ${eventType}`);
        }
    }

    public async syncHistoricalCheckpoints(network: Network): Promise<void> {
        return this.checkpointStatusFetcher.syncHistoricalCheckpoints(network);
    }

    public async getCurrentEpoch(network: Network): Promise<number> {
        return this.checkpointStatusFetcher.getCurrentEpoch(network);
    }

    private async initializeHistoricalSync() {
        try {
            console.log('[CheckpointStatus] Starting historical sync initialization');
            // Her network için senkronizasyonu başlat
            const networks = [Network.MAINNET, Network.TESTNET];
            
            for (const network of networks) {
                try {
                    const client = this.checkpointStatusFetcher.getBabylonClient(network);
                    if (client) {
                        console.log(`[CheckpointStatus] Starting historical sync for ${network}`);
                        await this.checkpointStatusFetcher.syncHistoricalCheckpoints(network);
                        console.log(`[CheckpointStatus] Completed historical sync for ${network}`);
                    }
                } catch (error) {
                    console.error(`[CheckpointStatus] Error syncing historical checkpoints for ${network}:`, error);
                }
            }
            console.log('[CheckpointStatus] Completed historical sync initialization');
        } catch (error) {
            console.error('[CheckpointStatus] Error initializing historical sync:', error);
            throw error;
        }
    }
} 