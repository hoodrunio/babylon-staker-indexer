import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { 
    BTCDelegation,
    DelegationResponse,
    BTCDelegationStatus
} from '../../types/finality/btcstaking';
import { formatSatoshis } from '../../utils/util';
import { getTxHash } from '../../utils/generate-tx-hash';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { extractAddressesFromTransaction } from '../../utils/btc-transaction';
interface ChainDelegationResponse {
    btc_delegations: BTCDelegation[];
    pagination?: {
        next_key?: string;
    };
}

export class BTCDelegationService {
    private static instance: BTCDelegationService | null = null;
    private babylonClients: Map<Network, BabylonClient>;
    private readonly SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private delegationModel: typeof NewBTCDelegation;
    private isSyncing = false;

    private constructor() {
        this.babylonClients = new Map();
        this.delegationModel = NewBTCDelegation;
        
        try {
            this.babylonClients.set(Network.TESTNET, BabylonClient.getInstance(Network.TESTNET));
            console.log('[Network] Testnet client initialized successfully');
        } catch (error) {
            if (error instanceof Error && error.message.includes('Missing configuration')) {
                console.error('[Network] Testnet is not configured');
            } else {
                console.error('[Network] Failed to initialize testnet client:', error);
            }
        }

        try {
            this.babylonClients.set(Network.MAINNET, BabylonClient.getInstance(Network.MAINNET));
            console.log('[Network] Mainnet client initialized successfully');
        } catch (error) {
            if (error instanceof Error && error.message.includes('Missing configuration')) {
                console.error('[Network] Mainnet is not configured');
            } else {
                console.error('[Network] Failed to initialize mainnet client:', error);
            }
        }

        if (this.babylonClients.size === 0) {
            throw new Error('No network configurations available. Please configure at least one network (testnet or mainnet).');
        }
        
        const networks = Array.from(this.babylonClients.keys());
        const enableFullSync = process.env.ENABLE_FULL_SYNC === 'true';
        
        if (enableFullSync) {
            console.log(`[Network] Starting initial delegation sync for configured networks: ${networks.join(', ')}`);
            for (const network of networks) {
                this.syncDelegations(network).catch(err => 
                    console.error(`[${network}] Error in initial sync:`, err)
                );
            }
        } else {
            console.log('[Network] Full sync is disabled, skipping initial delegation sync');
        }
    }

    public static getInstance(): BTCDelegationService {
        if (!BTCDelegationService.instance) {
            BTCDelegationService.instance = new BTCDelegationService();
        }
        return BTCDelegationService.instance;
    }

    private getBabylonClient(network: Network): BabylonClient {
        const client = this.babylonClients.get(network);
        if (!client) {
            throw new Error(`No BabylonClient instance found for network: ${network}`);
        }
        return client;
    }

    private getNetworkConfig(network: Network = Network.MAINNET) {
        const client = this.getBabylonClient(network);
        const baseUrl = client.getBaseUrl();
        
        if (!baseUrl) {
            throw new Error(`Missing configuration for ${network} network`);
        }

        return {
            nodeUrl: baseUrl,
            rpcUrl: baseUrl
        };
    }

    private async startPeriodicSync() {
        let isPeriodicSyncRunning = false;

        setInterval(async () => {
            if (isPeriodicSyncRunning) {
                console.log('[Network] Previous periodic sync still running, skipping...');
                return;
            }

            try {
                isPeriodicSyncRunning = true;
                const networks = Array.from(this.babylonClients.keys());
                console.log(`[Network] Starting periodic delegation sync for configured networks: ${networks.join(', ')}`);
                
                for (const network of networks) {
                    if (this.isSyncing) {
                        console.log(`[${network}] Manual sync in progress, skipping periodic sync...`);
                        continue;
                    }
                    await this.syncDelegations(network).catch(err => 
                        console.error(`[${network}] Error in periodic sync:`, err)
                    );
                }
            } catch (error) {
                console.error('[Network] Error in periodic delegation sync:', error);
            } finally {
                isPeriodicSyncRunning = false;
            }
        }, this.SYNC_INTERVAL);
    }

    private async syncDelegations(network: Network) {
        if (this.isSyncing) {
            console.log(`[${network}] Sync already in progress, skipping...`);
            return;
        }

        try {
            this.isSyncing = true;
            
            const statuses = Object.values(BTCDelegationStatus);
            let totalDelegations = 0;
            let totalCreated = 0;
            let totalUpdated = 0;

            const BATCH_SIZE = 100;
            
            for (const status of statuses) {
                const chainDelegations = await this.fetchDelegationsFromChain(status, network);
                if (!chainDelegations || chainDelegations.length === 0) {
                    continue;
                }

                totalDelegations += chainDelegations.length;
                
                for (let i = 0; i < chainDelegations.length; i += BATCH_SIZE) {
                    const batch = chainDelegations.slice(i, i + BATCH_SIZE);
                    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
                    const totalBatches = Math.ceil(chainDelegations.length / BATCH_SIZE);
                    
                    console.log(`[${network}] Processing batch ${batchNumber}/${totalBatches} for status ${status}`);
                    
                    const batchResults = await this.processBatch(batch, network);
                    
                    totalCreated += batchResults.created || 0;
                    totalUpdated += batchResults.updated || 0;

                    if (Object.keys(batchResults).length > 0) {
                        console.log(`[${network}] Batch ${batchNumber}/${totalBatches} results:`, batchResults);
                    }
                }
            }
            
            console.log(`[${network}] Sync completed:`, {
                totalDelegationsFound: totalDelegations,
                newDelegationsCreated: totalCreated,
                delegationsUpdated: totalUpdated
            });
        } catch (error) {
            console.error(`[${network}] Error syncing delegations:`, error);
        } finally {
            this.isSyncing = false;
        }
    }

    private async processDelegation(del: BTCDelegation): Promise<DelegationResponse | null> {
        if (!del) {
            console.warn('Delegation is null');
            return null;
        }

        try {
            console.log('Processing delegation with staking_tx_hex:', del.staking_tx_hex);
            let senderAddress = '';
            try {
                const addresses = await extractAddressesFromTransaction(del.staking_tx_hex);
                // console.log('Extracted addresses:', addresses);
                senderAddress = addresses.sender || '';
            } catch (error) {
                console.error('Failed to extract sender address from staking transaction:', error);
                console.error('Transaction hex that failed:', del.staking_tx_hex);
                return null;
            }

            const totalSat = Number(del.total_sat);
            if (isNaN(totalSat)) {
                console.warn(`Invalid total_sat value for delegation:`, del);
                return null;
            }

            return {
                staker_address: del.staker_addr || '',
                stakerBtcAddress: senderAddress || '',
                status: del.status_desc || '',
                btc_pk_hex: del.btc_pk || '',
                amount: formatSatoshis(totalSat),
                amount_sat: totalSat,
                start_height: Number(del.start_height) || 0,
                end_height: Number(del.end_height) || 0,
                duration: Number(del.staking_time) || 0,
                transaction_id_hex: getTxHash(del.staking_tx_hex || '', false),
                transaction_id: del.staking_tx_hex || '',
                active: del.active,
                unbonding_time: del.unbonding_time,
                unbonding: del.undelegation_response ? {
                    transaction_id: del.undelegation_response.unbonding_tx_hex,
                    transaction_id_hex: getTxHash(del.undelegation_response.unbonding_tx_hex || '', false)
                } : undefined,
                params_version: del.params_version,
                finality_provider_btc_pks_hex: del.fp_btc_pk_list || []
            };
        } catch (error) {
            console.error('Error processing delegation:', error);
            return null;
        }
    }

    private async processBatch(batch: DelegationResponse[], network: Network) {
        const results = await Promise.allSettled(
            batch.map(async (chainDel) => {
                if (!chainDel?.transaction_id_hex) {
                    return { type: 'error', error: 'Missing transaction_id_hex' };
                }

                try {
                    const existingDel = await this.delegationModel.findOne({
                        $or: [
                            { stakingTxHex: chainDel.transaction_id },
                            { stakingTxIdHex: chainDel.transaction_id_hex }
                        ],
                        networkType: network.toLowerCase()
                    });

                    if (!existingDel) {
                        const result = await this.createDelegationFromChainData(chainDel, network);
                        return { type: 'created', id: chainDel.transaction_id_hex };
                    } else if (existingDel.state !== chainDel.status) {
                        await this.updateDelegationState(chainDel.transaction_id_hex, chainDel.status, network);
                        return { type: 'updated', id: chainDel.transaction_id_hex };
                    }
                    return { type: 'unchanged', id: chainDel.transaction_id_hex };
                } catch (error) {
                    return { 
                        type: 'error', 
                        id: chainDel.transaction_id_hex,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    };
                }
            })
        );

        const summary = results.reduce((acc, result) => {
            if (result.status === 'fulfilled') {
                acc[result.value.type] = (acc[result.value.type] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);

        return summary;
    }

    private async fetchDelegationsFromChain(
        status: BTCDelegationStatus,
        network: Network,
        pageKey?: string,
        pageLimit: number = 100,
        retryCount: number = 0
    ): Promise<DelegationResponse[]> {
        const maxRetries = 5;
        const retryDelay = (retryCount: number) => Math.min(1000 * Math.pow(2, retryCount), 10000); // exponential backoff
        const { nodeUrl } = this.getNetworkConfig(network);
        const url = new URL(`${nodeUrl}/babylon/btcstaking/v1/btc_delegations/${status}`);
        
        url.searchParams.append('pagination.limit', pageLimit.toString());
        if (pageKey) {
            url.searchParams.append('pagination.key', pageKey);
        }

        if (!pageKey) {
            console.log(`[${network}] Fetching ${status} delegations...`);
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

            const response = await fetch(url.toString(), {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                },
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[${network}] HTTP error fetching delegations:`, {
                    status: response.status,
                    url: url.toString(),
                    error: errorText,
                    attempt: retryCount + 1
                });

                if (retryCount < maxRetries) {
                    const delay = retryDelay(retryCount);
                    console.log(`[${network}] Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.fetchDelegationsFromChain(status, network, pageKey, pageLimit, retryCount + 1);
                }
                throw new Error(`Failed to fetch delegations after ${maxRetries} retries`);
            }

            const data = await response.json() as ChainDelegationResponse;
            
            if (!data.btc_delegations) {
                return [];
            }

            const delegationsPromises = data.btc_delegations.map(async del => {
                try {
                    return await this.processDelegation(del);
                } catch (error) {
                    console.error(`[${network}] Error processing delegation:`, error);
                    return null;
                }
            });

            const delegationsResults = await Promise.all(delegationsPromises);
            const delegations = delegationsResults.filter((del): del is DelegationResponse => del !== null);
            
            if (data.pagination?.next_key) {
                try {
                    const nextDelegations = await this.fetchDelegationsFromChain(
                        status,
                        network,
                        data.pagination.next_key,
                        pageLimit
                    );
                    return [...delegations, ...nextDelegations];
                } catch (error) {
                    console.error(`[${network}] Error fetching next page:`, error);
                    // Return current page if next page fails
                    return delegations;
                }
            }

            return delegations;
        } catch (error) {
            const isAbortError = error instanceof Error && error.name === 'AbortError';
            const isConnectionError = error instanceof Error && 
                (error.message.includes('ECONNRESET') || 
                 error.message.includes('ETIMEDOUT') ||
                 error.message.includes('ECONNREFUSED'));

            console.error(`[${network}] Error fetching ${status} delegations:`, {
                error: error instanceof Error ? error.message : 'Unknown error',
                type: isAbortError ? 'timeout' : isConnectionError ? 'connection' : 'unknown',
                url: url.toString(),
                pageKey,
                attempt: retryCount + 1
            });

            if (retryCount < maxRetries && (isAbortError || isConnectionError)) {
                const delay = retryDelay(retryCount);
                console.log(`[${network}] Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.fetchDelegationsFromChain(status, network, pageKey, pageLimit, retryCount + 1);
            }

            throw error;
        }
    }

    private async createDelegationFromChainData(chainDel: DelegationResponse, network: Network) {
        try {
            if (!chainDel?.transaction_id_hex) {
                throw new Error('Missing transaction_id_hex in delegation data');
            }

            const existingDelegation = await this.delegationModel.findOne({
                $or: [
                    { stakingTxHex: chainDel.transaction_id },
                    { stakingTxIdHex: chainDel.transaction_id_hex }
                ],
                networkType: network.toLowerCase()
            });

            if (existingDelegation) {
                if (existingDelegation.state !== chainDel.status) {
                    existingDelegation.state = this.mapStatusToEnum(chainDel.status);
                    return await existingDelegation.save();
                }
                return existingDelegation;
            }

            const currentHeight = await this.getBabylonClient(network).getCurrentHeight();

            const delegation = new this.delegationModel({
                stakingTxHex: chainDel.transaction_id,
                stakingTxIdHex: chainDel.transaction_id_hex,
                stakerAddress: chainDel.staker_address,
                stakerBtcAddress: chainDel.stakerBtcAddress || '',
                stakerBtcPkHex: chainDel.btc_pk_hex,
                state: this.mapStatusToEnum(chainDel.status),
                networkType: network.toLowerCase(),
                totalSat: chainDel.amount_sat,
                startHeight: chainDel.start_height,
                endHeight: chainDel.end_height || 0,
                stakingTime: chainDel.duration,
                unbondingTime: chainDel.unbonding_time,
                blockHeight: currentHeight,
                txHash: chainDel.transaction_id_hex,
                finalityProviderBtcPksHex: chainDel.finality_provider_btc_pks_hex || []
            });

            return await delegation.save();
        } catch (error) {
            throw error;
        }
    }

    private mapStatusToEnum(status: string): 'PENDING' | 'VERIFIED' | 'ACTIVE' | 'UNBONDED' {
        const normalizedStatus = status.toUpperCase();
        switch (normalizedStatus) {
            case 'PENDING':
                return 'PENDING';
            case 'VERIFIED':
                return 'VERIFIED';
            case 'ACTIVE':
                return 'ACTIVE';
            case 'UNBONDED':
                return 'UNBONDED';
            default:
                console.warn(`Unknown status: ${status}, defaulting to PENDING`);
                return 'PENDING';
        }
    }

    public async updateDelegationState(stakingTxIdHex: string, state: string, network: Network) {
        try {
            const result = await this.delegationModel.findOneAndUpdate(
                { 
                    stakingTxIdHex,
                    networkType: network.toLowerCase()
                },
                { state },
                { new: true }
            );

            if (!result) {
                console.error('No delegation found to update:', {
                    stakingTxIdHex,
                    network: network.toLowerCase()
                });
                return null;
            }

            return result;
        } catch (error) {
            console.error('Error updating delegation state:', error);
            throw error;
        }
    }

    private async getDelegationFromChain(txData: any, network: Network): Promise<any> {
        try {
            const chainDel = await this.fetchDelegationsFromChain(txData, network);
            return chainDel;
        } catch (error) {
            console.error(`Error getting delegation from chain: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return null;
        }
    }

    private async reconcileDelegations(chainDelegations: DelegationResponse[], network: Network) {
        if (!chainDelegations || chainDelegations.length === 0) {
            return;
        }

        // Küçük batch'ler için doğrudan işlem yap
        if (chainDelegations.length <= 5) {
            const results = await Promise.allSettled(
                chainDelegations.map(async (chainDel) => {
                    try {
                        if (!chainDel?.transaction_id_hex) {
                            return { type: 'error', error: 'Missing transaction_id_hex' };
                        }

                        const existingDel = await this.delegationModel.findOne({
                            $or: [
                                { stakingTxHex: chainDel.transaction_id },
                                { stakingTxIdHex: chainDel.transaction_id_hex }
                            ],
                            networkType: network.toLowerCase()
                        });

                        if (!existingDel) {
                            await this.createDelegationFromChainData(chainDel, network);
                            return { type: 'created', id: chainDel.transaction_id_hex };
                        } else if (existingDel.state !== chainDel.status) {
                            await this.updateDelegationState(chainDel.transaction_id_hex, chainDel.status, network);
                            return { type: 'updated', id: chainDel.transaction_id_hex };
                        }
                        return { type: 'unchanged', id: chainDel.transaction_id_hex };
                    } catch (error) {
                        return { 
                            type: 'error', 
                            id: chainDel.transaction_id_hex,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        };
                    }
                })
            );

            // Sadece değişiklikleri logla
            const stats = results.reduce((acc, result) => {
                if (result.status === 'fulfilled') {
                    acc[result.value.type] = (acc[result.value.type] || 0) + 1;
                }
                return acc;
            }, {} as Record<string, number>);

            if (Object.keys(stats).length > 0) {
                console.log(`[${network}] Reconciliation results:`, stats);
            }

            return;
        }

        // Büyük batch'ler için normal sync işlemini kullan
        await this.syncDelegations(network);
    }

    public async handleNewDelegationFromWebsocket(txData: any, network: Network): Promise<any> {
        try {
            const chainDel = await this.getDelegationFromChain(txData, network);
            if (!chainDel) {
                console.log(`[${network}] No valid delegation found in transaction data`);
                return null;
            }

            // Tekli delegasyon için reconcile kullan
            await this.reconcileDelegations([chainDel], network);
            return chainDel;
        } catch (error) {
            console.error('Error handling new delegation from websocket:', error);
            throw error;
        }
    }
} 