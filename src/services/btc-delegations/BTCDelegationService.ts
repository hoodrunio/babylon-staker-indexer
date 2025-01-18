import { Network } from '../../api/middleware/network-selector';
import { BabylonClient } from '../../clients/BabylonClient';
import { CacheService } from '../CacheService';
import { 
    BTCDelegation,
    DelegationResponse,
    BTCDelegationStatus
} from '../../types/finality/btcstaking';
import { formatSatoshis } from '../../utils/util';
import { getTxHash } from '../../utils/generate-tx-hash';

interface CacheEntry<T> {
    data: T;
    lastFetched: number;
}

interface StatusDelegationsCache {
    delegations: DelegationResponse[];
    pagination_keys: string[];
    total_stats: {
        total_amount: string;
        total_amount_sat: number;
    };
    last_updated: number;
}

export class BTCDelegationService {
    private static instance: BTCDelegationService | null = null;
    private babylonClient: BabylonClient;
    private cache: CacheService;
    private updateJobs: Map<string, NodeJS.Timeout> = new Map();
    
    private readonly CACHE_TTL = {
        STATUS_DELEGATIONS: 0,  // Sonsuz TTL
        SINGLE_DELEGATION: 600,    // 10 dakika
    };

    private readonly UPDATE_INTERVAL = 10 * 60 * 1000; // 1 dakika

    private constructor() {
        if (!process.env.BABYLON_NODE_URL || !process.env.BABYLON_RPC_URL) {
            throw new Error('BABYLON_NODE_URL and BABYLON_RPC_URL environment variables must be set');
        }
        this.babylonClient = BabylonClient.getInstance(
            process.env.BABYLON_NODE_URL,
            process.env.BABYLON_RPC_URL
        );
        this.cache = CacheService.getInstance();
    }

    public static getInstance(): BTCDelegationService {
        if (!BTCDelegationService.instance) {
            BTCDelegationService.instance = new BTCDelegationService();
        }
        return BTCDelegationService.instance;
    }

    private getNetworkConfig(network: Network = Network.MAINNET) {
        return {
            nodeUrl: network === Network.MAINNET ? process.env.BABYLON_NODE_URL : process.env.BABYLON_TESTNET_NODE_URL,
            rpcUrl: network === Network.MAINNET ? process.env.BABYLON_RPC_URL : process.env.BABYLON_TESTNET_RPC_URL
        };
    }

    private processDelegation(del: BTCDelegation): DelegationResponse | null {
        if (!del) return null;

        const totalSat = Number(del.total_sat);
        if (isNaN(totalSat)) {
            console.warn(`Invalid total_sat value for delegation:`, del);
            return null;
        }

        const response: DelegationResponse = {
            staker_address: del.staker_addr || '',
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
            unbonding_time: del.unbonding_time
        };

        if (del.undelegation_response) {
            response.unbonding = {
                transaction_id: del.undelegation_response.unbonding_tx_hex,
                transaction_id_hex: getTxHash(del.undelegation_response.unbonding_tx_hex || '', false),
                spend_transaction_id: del.undelegation_response.delegator_unbonding_info?.spend_stake_tx_hex
            };
        }

        return response;
    }

    private getStatusCacheKey(status: BTCDelegationStatus, network: Network): string {
        return `btc:delegations:status:${status}:${network}`;
    }

    private getDelegationCacheKey(stakingTxHash: string, network: Network): string {
        return `btc:delegation:${stakingTxHash}:${network}`;
    }

    private async fetchDelegationsByStatus(
        status: BTCDelegationStatus,
        network: Network,
        pageKey?: string,
        pageLimit: number = 100
    ): Promise<{
        delegations: DelegationResponse[];
        next_key?: string;
    }> {
        const { nodeUrl } = this.getNetworkConfig(network);
        const url = new URL(`${nodeUrl}/babylon/btcstaking/v1/btc_delegations/${status}`);
        
        url.searchParams.append('pagination.limit', pageLimit.toString());
        if (pageKey) {
            url.searchParams.append('pagination.key', pageKey);
        }

        const response = await fetch(url.toString());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json() as {
            btc_delegations?: BTCDelegation[];
            pagination?: {
                next_key?: string;
            };
        };
        
        const delegations = data.btc_delegations?.map((del: BTCDelegation) => this.processDelegation(del))
            .filter((d: DelegationResponse | null): d is DelegationResponse => d !== null) || [];

        return {
            delegations,
            next_key: data.pagination?.next_key
        };
    }

    public async getDelegationsByStatus(
        status: BTCDelegationStatus,
        network: Network = Network.MAINNET,
        page: number = 1,
        limit: number = 10
    ): Promise<{
        delegations: DelegationResponse[];
        pagination: {
            total_count: number;
            total_pages: number;
            current_page: number;
            has_next: boolean;
            has_previous: boolean;
            next_page: number | null;
            previous_page: number | null;
        };
        total_stats: {
            total_amount: string;
            total_amount_sat: number;
        };
    }> {
        const cacheKey = this.getStatusCacheKey(status, network);
        
        try {
            let cached = await this.cache.get<StatusDelegationsCache>(cacheKey);
            
            if (!cached) {
                console.log(`Cache miss for ${cacheKey}, fetching delegations...`);
                let allDelegations: DelegationResponse[] = [];
                let paginationKeys: string[] = [];
                let nextKey: string | undefined;

                do {
                    const data = await this.fetchDelegationsByStatus(status, network, nextKey);
                    allDelegations = [...allDelegations, ...data.delegations];
                    
                    if (data.next_key) {
                        paginationKeys.push(data.next_key);
                    }
                    
                    nextKey = data.next_key;
                } while (nextKey);

                const totalAmountSat = allDelegations.reduce((sum, d) => sum + d.amount_sat, 0);

                cached = {
                    delegations: allDelegations,
                    pagination_keys: paginationKeys,
                    total_stats: {
                        total_amount: formatSatoshis(totalAmountSat),
                        total_amount_sat: totalAmountSat
                    },
                    last_updated: Date.now()
                };
                
                await this.cache.set(cacheKey, cached, this.CACHE_TTL.STATUS_DELEGATIONS);
                this.startUpdateJob(status, network);
            }

            const totalCount = cached.delegations.length;
            const totalPages = Math.ceil(totalCount / limit);
            const currentPage = Math.min(Math.max(1, page), totalPages || 1);
            const startIndex = (currentPage - 1) * limit;
            const endIndex = startIndex + limit;
            
            return {
                delegations: cached.delegations.slice(startIndex, endIndex),
                pagination: {
                    total_count: totalCount,
                    total_pages: totalPages,
                    current_page: currentPage,
                    has_next: currentPage < totalPages,
                    has_previous: currentPage > 1,
                    next_page: currentPage < totalPages ? currentPage + 1 : null,
                    previous_page: currentPage > 1 ? currentPage - 1 : null
                },
                total_stats: cached.total_stats
            };
        } catch (error) {
            console.error(`Error in getDelegationsByStatus for ${cacheKey}:`, error);
            return {
                delegations: [],
                pagination: {
                    total_count: 0,
                    total_pages: 0,
                    current_page: page,
                    has_next: false,
                    has_previous: false,
                    next_page: null,
                    previous_page: null
                },
                total_stats: {
                    total_amount: '0',
                    total_amount_sat: 0
                }
            };
        }
    }

    public async getDelegationByTxHash(
        stakingTxHash: string,
        network: Network = Network.MAINNET
    ): Promise<DelegationResponse | null> {
        const cacheKey = this.getDelegationCacheKey(stakingTxHash, network);
        
        try {
            const cached = await this.cache.get<CacheEntry<DelegationResponse>>(cacheKey);
            
            if (cached && (Date.now() - cached.lastFetched < this.CACHE_TTL.SINGLE_DELEGATION * 1000)) {
                return cached.data;
            }

            const { nodeUrl } = this.getNetworkConfig(network);
            const response = await fetch(`${nodeUrl}/babylon/btcstaking/v1/btc_delegation/${stakingTxHash}`);
            
            if (!response.ok) {
                if (response.status === 404) {
                    return null;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json() as {
                btc_delegation?: BTCDelegation;
            };
            
            const delegation = data.btc_delegation ? this.processDelegation(data.btc_delegation) : null;

            if (delegation) {
                await this.cache.set(cacheKey, {
                    data: delegation,
                    lastFetched: Date.now()
                }, this.CACHE_TTL.SINGLE_DELEGATION);
            }

            return delegation;
        } catch (error) {
            console.error(`Error in getDelegationByTxHash for ${stakingTxHash}:`, error);
            return null;
        }
    }

    private startUpdateJob(status: BTCDelegationStatus, network: Network) {
        const cacheKey = this.getStatusCacheKey(status, network);
        
        if (this.updateJobs.has(cacheKey)) {
            return;
        }

        const intervalId = setInterval(async () => {
            try {
                const cached = await this.cache.get<StatusDelegationsCache>(cacheKey);
                if (!cached) return;

                const lastKey = cached.pagination_keys[cached.pagination_keys.length - 1];
                const newData = await this.fetchDelegationsByStatus(status, network, lastKey);
                
                if (newData.delegations.length > 0) {
                    const existingTxIds = new Set(cached.delegations.map(d => d.transaction_id));
                    const newUniqueDelegations = newData.delegations.filter(d => !existingTxIds.has(d.transaction_id));

                    if (newUniqueDelegations.length > 0) {
                        const oldStats = cached.total_stats;
                        cached.delegations = [...cached.delegations, ...newUniqueDelegations];
                        
                        const totalAmountSat = cached.delegations.reduce((sum, d) => sum + d.amount_sat, 0);
                        cached.total_stats = {
                            total_amount: formatSatoshis(totalAmountSat),
                            total_amount_sat: totalAmountSat
                        };
                        
                        cached.last_updated = Date.now();
                        
                        if (newData.next_key) {
                            cached.pagination_keys.push(newData.next_key);
                        }

                        console.log(`Updated ${status} delegations:`, {
                            new_unique_delegations: newUniqueDelegations.length,
                            total_delegations: cached.delegations.length,
                            old_total: oldStats.total_amount,
                            new_total: cached.total_stats.total_amount,
                            change: formatSatoshis(cached.total_stats.total_amount_sat - oldStats.total_amount_sat)
                        });
                        
                        await this.cache.set(cacheKey, cached, this.CACHE_TTL.STATUS_DELEGATIONS);
                    } else {
                        console.log(`No new unique delegations found for ${status}`);
                    }
                } else {
                    console.log(`No new delegations found for ${status}`);
                }
            } catch (error) {
                console.error(`Error updating delegations cache for ${cacheKey}:`, error);
            }
        }, this.UPDATE_INTERVAL);
        
        this.updateJobs.set(cacheKey, intervalId);
    }

    public stopUpdateJob(status: BTCDelegationStatus, network: Network) {
        const cacheKey = this.getStatusCacheKey(status, network);
        if (this.updateJobs.has(cacheKey)) {
            clearInterval(this.updateJobs.get(cacheKey)!);
            this.updateJobs.delete(cacheKey);
        }
    }

    public async clearCache(status: BTCDelegationStatus, network: Network) {
        const cacheKey = this.getStatusCacheKey(status, network);
        await this.cache.del(cacheKey);
        this.stopUpdateJob(status, network);
    }
} 