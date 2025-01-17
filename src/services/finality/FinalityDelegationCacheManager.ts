import { CacheService } from '../CacheService';
import { DelegationResponse } from '../../types/finality/btcstaking';
import { Network } from '../../api/middleware/network-selector';
import { formatSatoshis } from '../../utils/util';

interface PaginatedDelegations {
    delegations: DelegationResponse[];
    pagination_keys: string[];
    total_stats: {
        total_amount: string;
        total_amount_sat: number;
        active_amount: string;
        active_amount_sat: number;
        unbonding_amount: string;
        unbonding_amount_sat: number;
    };
    last_updated: number;
}

export class FinalityDelegationCacheManager {
    private static instance: FinalityDelegationCacheManager | null = null;
    private cache: CacheService;
    private updateJobs: Map<string, NodeJS.Timeout> = new Map();
    
    private readonly CACHE_TTL = {
        DELEGATIONS_INITIAL: 1800,  // 30 dakika
        DELEGATIONS_UPDATES: 300,   // 5 dakika
    };

    private readonly UPDATE_INTERVAL = 5 * 60 * 1000; // 5 dakika
    private readonly INITIAL_FETCH_LIMIT = 500;

    private constructor() {
        this.cache = CacheService.getInstance();
    }

    public static getInstance(): FinalityDelegationCacheManager {
        if (!FinalityDelegationCacheManager.instance) {
            FinalityDelegationCacheManager.instance = new FinalityDelegationCacheManager();
        }
        return FinalityDelegationCacheManager.instance;
    }

    private getDelegationsCacheKey(fpBtcPkHex: string, network: Network): string {
        return `fp:delegations:${fpBtcPkHex}:${network}`;
    }

    private calculateDelegationStats(delegations: DelegationResponse[]) {
        const stats = delegations.reduce((acc, del) => {
            if (del.active) {
                acc.active_amount_sat += del.amount_sat;
            } else if (del.unbonding) {
                acc.unbonding_amount_sat += del.amount_sat;
            }
            acc.total_amount_sat += del.amount_sat;
            return acc;
        }, {
            total_amount_sat: 0,
            active_amount_sat: 0,
            unbonding_amount_sat: 0
        });

        return {
            total_amount: formatSatoshis(stats.total_amount_sat),
            total_amount_sat: stats.total_amount_sat,
            active_amount: formatSatoshis(stats.active_amount_sat),
            active_amount_sat: stats.active_amount_sat,
            unbonding_amount: formatSatoshis(stats.unbonding_amount_sat),
            unbonding_amount_sat: stats.unbonding_amount_sat
        };
    }

    private async fetchAllDelegations(
        fpBtcPkHex: string,
        network: Network,
        fetchCallback: (fpBtcPkHex: string, network: Network, pageKey?: string, pageLimit?: number) => Promise<{
            delegations: DelegationResponse[];
            next_key?: string;
        }>,
        initialLimit: number = this.INITIAL_FETCH_LIMIT
    ): Promise<{
        delegations: DelegationResponse[];
        pagination_keys: string[];
    }> {
        let allDelegations: DelegationResponse[] = [];
        let paginationKeys: string[] = [];
        let nextKey: string | undefined;
        let isFirstFetch = true;

        do {
            const limit = isFirstFetch ? initialLimit : 100;
            const data = await fetchCallback(fpBtcPkHex, network, nextKey, limit);
            
            allDelegations = [...allDelegations, ...data.delegations];
            
            if (data.next_key) {
                paginationKeys.push(data.next_key);
            }
            
            nextKey = data.next_key;
            isFirstFetch = false;

            console.log(`Fetched ${data.delegations.length} delegations, total so far: ${allDelegations.length}`);
        } while (nextKey);

        return {
            delegations: allDelegations,
            pagination_keys: paginationKeys
        };
    }

    public async getDelegations(
        fpBtcPkHex: string,
        network: Network,
        page: number,
        limit: number,
        fetchCallback: (fpBtcPkHex: string, network: Network, pageKey?: string, pageLimit?: number) => Promise<{
            delegations: DelegationResponse[];
            next_key?: string;
        }>
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
            active_amount: string;
            active_amount_sat: number;
            unbonding_amount: string;
            unbonding_amount_sat: number;
        };
    }> {
        const cacheKey = this.getDelegationsCacheKey(fpBtcPkHex, network);
        
        try {
            let cached = await this.cache.get<PaginatedDelegations>(cacheKey);
            
            if (!cached) {
                console.log(`Cache miss for ${cacheKey}, fetching all delegations...`);
                const { delegations, pagination_keys } = await this.fetchAllDelegations(fpBtcPkHex, network, fetchCallback);
                
                if (!delegations.length) {
                    return this.getEmptyResponse(page);
                }
                
                cached = {
                    delegations,
                    pagination_keys,
                    total_stats: this.calculateDelegationStats(delegations),
                    last_updated: Date.now()
                };
                
                console.log(`Fetched ${delegations.length} total delegations with stats:`, cached.total_stats);
                
                await this.cache.set(cacheKey, cached, this.CACHE_TTL.DELEGATIONS_INITIAL);
                this.startUpdateJob(fpBtcPkHex, network, fetchCallback);
            }

            if (!cached || !cached.delegations) {
                return this.getEmptyResponse(page);
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
            console.error(`Error in getDelegations for ${cacheKey}:`, error);
            return this.getEmptyResponse(page);
        }
    }

    private getEmptyResponse(page: number) {
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
                total_amount_sat: 0,
                active_amount: '0',
                active_amount_sat: 0,
                unbonding_amount: '0',
                unbonding_amount_sat: 0
            }
        };
    }

    private startUpdateJob(
        fpBtcPkHex: string,
        network: Network,
        fetchCallback: (fpBtcPkHex: string, network: Network, pageKey?: string, pageLimit?: number) => Promise<{
            delegations: DelegationResponse[];
            next_key?: string;
        }>
    ) {
        const cacheKey = this.getDelegationsCacheKey(fpBtcPkHex, network);
        
        if (this.updateJobs.has(cacheKey)) {
            clearInterval(this.updateJobs.get(cacheKey)!);
        }
        
        const intervalId = setInterval(async () => {
            try {
                const cached = await this.cache.get<PaginatedDelegations>(cacheKey);
                if (!cached) return;

                const lastKey = cached.pagination_keys[cached.pagination_keys.length - 1];
                const newData = await fetchCallback(fpBtcPkHex, network, lastKey, 100);
                
                if (newData.delegations.length > 0) {
                    const oldStats = cached.total_stats;
                    cached.delegations = [...cached.delegations, ...newData.delegations];
                    cached.total_stats = this.calculateDelegationStats(cached.delegations);
                    cached.last_updated = Date.now();
                    
                    if (newData.next_key) {
                        cached.pagination_keys.push(newData.next_key);
                    }

                    /* console.log(`Updated delegations for ${fpBtcPkHex}:`, {
                        new_delegations: newData.delegations.length,
                        total_delegations: cached.delegations.length,
                        old_total: oldStats.total_amount,
                        new_total: cached.total_stats.total_amount,
                        change: formatSatoshis(cached.total_stats.total_amount_sat - oldStats.total_amount_sat)
                    }); */
                    
                    await this.cache.set(cacheKey, cached, this.CACHE_TTL.DELEGATIONS_INITIAL);
                }
            } catch (error) {
                console.error(`Error updating delegations cache for ${cacheKey}:`, error);
            }
        }, this.UPDATE_INTERVAL);
        
        this.updateJobs.set(cacheKey, intervalId);
    }

    public stopUpdateJob(fpBtcPkHex: string, network: Network) {
        const cacheKey = this.getDelegationsCacheKey(fpBtcPkHex, network);
        if (this.updateJobs.has(cacheKey)) {
            clearInterval(this.updateJobs.get(cacheKey)!);
            this.updateJobs.delete(cacheKey);
        }
    }

    public async clearCache(fpBtcPkHex: string, network: Network) {
        const cacheKey = this.getDelegationsCacheKey(fpBtcPkHex, network);
        await this.cache.del(cacheKey);
        this.stopUpdateJob(fpBtcPkHex, network);
    }
} 