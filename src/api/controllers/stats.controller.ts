import { Request, Response } from 'express';
import { Network } from '../../types/finality';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { FinalityProviderService } from '../../services/finality/FinalityProviderService';
import { formatSatoshis } from '../../utils/util';
import { BTCDelegationStatus } from '../../types/finality/btcstaking';
import { logger } from '../../utils/logger';
import { CacheService } from '../../services/CacheService';

export class StatsController {
    private static finalityProviderService = FinalityProviderService.getInstance();
    private static cacheService = CacheService.getInstance();
    private static CACHE_TTL = 300; // 5 minutes
    private static CACHE_REFRESH_INTERVAL = 240; // 4 minutes (refresh before expiry)
    private static refreshPromises: Map<string, Promise<any>> = new Map();
    private static refreshIntervals: Map<string, NodeJS.Timeout> = new Map();

    public static initialize() {
        // Setup background refresh for all supported networks
        this.setupBackgroundRefresh(Network.MAINNET);
        this.setupBackgroundRefresh(Network.TESTNET);
        
        logger.info('Stats controller initialized with background cache refresh');
    }

    private static setupBackgroundRefresh(network: Network) {
        const cacheKey = `stats:overall:${network.toLowerCase()}`;
        
        // Clear any existing interval
        if (this.refreshIntervals.has(cacheKey)) {
            clearInterval(this.refreshIntervals.get(cacheKey)!);
        }
        
        // Immediately calculate stats the first time
        this.refreshCache(network);
        
        // Set up interval to refresh the cache regularly
        const interval = setInterval(() => {
            this.refreshCache(network);
        }, this.CACHE_REFRESH_INTERVAL * 1000);
        
        this.refreshIntervals.set(cacheKey, interval);
        logger.info(`Set up background refresh for stats cache: ${network}`);
    }

    private static async refreshCache(network: Network) {
        const cacheKey = `stats:overall:${network.toLowerCase()}`;
        
        // Skip if refresh is already in progress
        if (this.refreshPromises.has(cacheKey)) {
            return;
        }
        
        try {
            logger.info(`Background refreshing stats cache for network: ${network}`);
            const refreshPromise = this.calculateStats(network);
            this.refreshPromises.set(cacheKey, refreshPromise);
            
            const statsData = await refreshPromise;
            await this.cacheService.set(cacheKey, statsData, this.CACHE_TTL);
            logger.info(`Successfully refreshed stats cache for network: ${network}`);
        } catch (error) {
            logger.error(`Error refreshing stats cache for network ${network}:`, error);
        } finally {
            this.refreshPromises.delete(cacheKey);
        }
    }

    public static async getStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.MAINNET;
            logger.info(`Fetching stats for network: ${network}`);

            // Try to get cached stats
            const cacheKey = `stats:overall:${network.toLowerCase()}`;
            const cachedStats = await StatsController.cacheService.get(cacheKey);
            
            if (cachedStats) {
                logger.info('Returning cached stats');
                return res.json(cachedStats);
            }

            // If cache is empty but a refresh is in progress, wait for it
            if (StatsController.refreshPromises.has(cacheKey)) {
                logger.info('Cache refresh in progress, waiting for calculation to complete');
                const statsData = await StatsController.refreshPromises.get(cacheKey);
                return res.json(statsData);
            }

            // No cache and no refresh in progress - calculate and cache
            logger.info('No cache available, calculating stats');
            const statsPromise = StatsController.calculateStats(network);
            StatsController.refreshPromises.set(cacheKey, statsPromise);
            
            try {
                const statsData = await statsPromise;
                await StatsController.cacheService.set(cacheKey, statsData, StatsController.CACHE_TTL);
                
                logger.info('Returning freshly calculated stats');
                res.json(statsData);
            } finally {
                StatsController.refreshPromises.delete(cacheKey);
            }
        } catch (error) {
            logger.error('Error in getStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    private static async calculateStats(network: Network) {
        try {
            const networkLower = network.toLowerCase();

            // Use aggregation for delegation stats - this is more efficient
            const delegationStats = await NewBTCDelegation.aggregate([
                { $match: { networkType: networkLower } },
                { 
                    $group: {
                        _id: "$state",
                        count: { $sum: 1 },
                        totalAmount: { $sum: "$totalSat" }
                    }
                }
            ]);

            // Initialize stats objects
            let activeTVL = 0;
            let pendingTVL = 0;
            let totalTVL = 0;
            let activeDelegationCount = 0;
            let pendingDelegationCount = 0;
            let totalDelegationCount = 0;

            // Process aggregation results
            delegationStats.forEach(stat => {
                totalTVL += stat.totalAmount;
                totalDelegationCount += stat.count;

                if (stat._id === BTCDelegationStatus.ACTIVE) {
                    activeTVL = stat.totalAmount;
                    activeDelegationCount = stat.count;
                } else if (stat._id === BTCDelegationStatus.PENDING) {
                    pendingTVL = stat.totalAmount;
                    pendingDelegationCount = stat.count;
                }
            });

            // Get all finality providers in parallel
            const [allFinalityProviders, activeFinalityProviders] = await Promise.all([
                StatsController.finalityProviderService.getAllFinalityProviders(network),
                StatsController.finalityProviderService.getActiveFinalityProviders(network)
            ]);

            // Get active delegations for TVL distribution
            const activeDelegations = await NewBTCDelegation.find({ 
                state: BTCDelegationStatus.ACTIVE, 
                networkType: networkLower 
            }).select('totalSat finalityProviderBtcPksHex').lean();

            // Calculate TVL distribution using the active delegations
            const tvlDistribution = StatsController.calculateTVLDistribution(
                activeFinalityProviders, 
                activeDelegations, 
                activeTVL
            );

            // Format response
            return {
                tvl: {
                    total: formatSatoshis(totalTVL),
                    total_sat: totalTVL,
                    confirmed: formatSatoshis(activeTVL),
                    confirmed_sat: activeTVL,
                    pending: formatSatoshis(pendingTVL),
                    pending_sat: pendingTVL
                },
                finality_providers: {
                    total: allFinalityProviders.length,
                    active: activeFinalityProviders.length
                },
                delegations: {
                    total: totalDelegationCount,
                    active: activeDelegationCount,
                    pending: pendingDelegationCount
                },
                tvl_distribution: tvlDistribution,
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error('Error in calculateStats:', error);
            throw error;
        }
    }

    private static calculateTVLDistribution(
        activeFinalityProviders: any[], 
        activeDelegations: any[],
        totalStakedAmount: number
    ) {
        try {
            // Create a lookup by btc_pk
            const providerLookup = new Map();
            activeFinalityProviders.forEach(provider => {
                providerLookup.set(provider.btc_pk, {
                    btc_pk: provider.btc_pk,
                    name: provider.description.moniker || provider.btc_pk.substring(0, 10) + '...',
                    staked_amount: 0,
                    staked_amount_sat: 0,
                    percentage: 0,
                    delegation_count: 0
                });
            });

            // Calculate staked amount per provider
            for (const delegation of activeDelegations) {
                if (delegation.finalityProviderBtcPksHex && delegation.finalityProviderBtcPksHex.length > 0) {
                    // Distribute delegation amount across assigned finality providers
                    const amountPerProvider = delegation.totalSat / delegation.finalityProviderBtcPksHex.length;
                    
                    for (const providerPk of delegation.finalityProviderBtcPksHex) {
                        if (providerLookup.has(providerPk)) {
                            const provider = providerLookup.get(providerPk);
                            provider.staked_amount_sat += amountPerProvider;
                            provider.delegation_count += 1;
                        }
                    }
                }
            }

            // Format output and calculate percentages
            const result = Array.from(providerLookup.values())
                .map(provider => {
                    return {
                        ...provider,
                        staked_amount: formatSatoshis(provider.staked_amount_sat),
                        percentage: totalStakedAmount > 0 
                            ? ((provider.staked_amount_sat / totalStakedAmount) * 100).toFixed(2) 
                            : "0.00"
                    };
                })
                .sort((a, b) => b.staked_amount_sat - a.staked_amount_sat);

            return result;
        } catch (error) {
            logger.error('Error in calculateTVLDistribution:', error);
            return [];
        }
    }
}
