import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { CacheService } from '../CacheService';
import { logger } from '../../utils/logger';

interface RewardGauge {
    coins: {
        denom: string;
        amount: string;
    }[];
    withdrawn_coins: {
        denom: string;
        amount: string;
    }[];
}

interface RewardGaugesResponse {
    reward_gauges: {
        [stakeholderType: string]: RewardGauge;
    };
}

interface CacheEntry<T> {
    data: T;
    lastFetched: number;
}

export class StakeholderRewardsService {
    private static instance: StakeholderRewardsService | null = null;
    private babylonClient: BabylonClient;
    private cache: CacheService;
    private revalidationPromises: Map<string, Promise<any>> = new Map();
    
    // Cache TTL values (in seconds)
    private readonly CACHE_TTL = {
        REWARDS: 300, // 5 minutes
        REWARDS_SUMMARY: 600 // 10 minutes
    };

    private constructor() {
        this.babylonClient = BabylonClient.getInstance(Network.MAINNET);
        this.cache = CacheService.getInstance();
    }

    public static getInstance(): StakeholderRewardsService {
        if (!StakeholderRewardsService.instance) {
            StakeholderRewardsService.instance = new StakeholderRewardsService();
        }
        return StakeholderRewardsService.instance;
    }

    private getNetworkConfig(network: Network = Network.MAINNET) {
        const client = BabylonClient.getInstance(network);
        return {
            nodeUrl: client.getBaseUrl(),
            rpcUrl: client.getRpcUrl()
        };
    }

    private async getWithRevalidate<T>(
        cacheKey: string,
        ttl: number,
        fetchFn: () => Promise<T>
    ): Promise<T> {
        try {
            const cachedEntry = await this.cache.get<CacheEntry<T>>(cacheKey);

            if (this.revalidationPromises.has(cacheKey)) {
                if (cachedEntry) {
                    return cachedEntry.data;
                }
                return this.revalidationPromises.get(cacheKey)!;
            }

            const now = Date.now();

            if (cachedEntry && (now - cachedEntry.lastFetched) < ttl * 1000) {
                return cachedEntry.data;
            }

            if (cachedEntry) {
                this.revalidateInBackground(cacheKey, fetchFn, ttl);
                return cachedEntry.data;
            }

            const revalidationPromise = this.fetchAndCache(cacheKey, fetchFn, ttl);
            this.revalidationPromises.set(cacheKey, revalidationPromise);

            const data = await revalidationPromise;
            this.revalidationPromises.delete(cacheKey);
            return data;
        } catch (error) {
            this.revalidationPromises.delete(cacheKey);
            throw error;
        }
    }

    private async revalidateInBackground<T>(
        cacheKey: string,
        fetchFn: () => Promise<T>,
        ttl: number
    ): Promise<void> {
        if (this.revalidationPromises.has(cacheKey)) {
            return;
        }

        const revalidationPromise = this.fetchAndCache(cacheKey, fetchFn, ttl);
        this.revalidationPromises.set(cacheKey, revalidationPromise);

        try {
            await revalidationPromise;
        } catch (error) {
            logger.error(`Background revalidation failed for ${cacheKey}:`, error);
        } finally {
            this.revalidationPromises.delete(cacheKey);
        }
    }

    private async fetchAndCache<T>(
        cacheKey: string,
        fetchFn: () => Promise<T>,
        ttl: number
    ): Promise<T> {
        const data = await fetchFn();
        const entry: CacheEntry<T> = {
            data,
            lastFetched: Date.now()
        };
        await this.cache.set(cacheKey, entry, ttl);
        return data;
    }

    /**
     * Get rewards for a stakeholder (finality provider or BTC staker)
     * @param address BTC address in bech32 format (bbn1...)
     * @param network Network to query
     * @returns Reward gauges for the stakeholder
     */
    public async getStakeholderRewards(address: string, network: Network = Network.MAINNET): Promise<RewardGaugesResponse> {
        const cacheKey = `rewards:${address}:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.REWARDS,
            async () => {
                const { nodeUrl } = this.getNetworkConfig(network);
                
                const url = `${nodeUrl}/babylon/incentive/address/${address}/reward_gauge`;
                const response = await fetch(url);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} when fetching rewards for ${address}`);
                }
                
                const data = await response.json() as RewardGaugesResponse;
                return data;
            }
        );
    }

    /**
     * Format rewards for API response
     * @param rawRewards Raw rewards data from blockchain
     * @returns Formatted rewards
     */
    public formatRewards(rawRewards: RewardGaugesResponse) {
        const result: {
            [stakeholderType: string]: {
                earned: { denom: string; amount: string; display_amount: string }[];
                withdrawn: { denom: string; amount: string; display_amount: string }[];
                available: { denom: string; amount: string; display_amount: string }[];
            };
        } = {};

        // Process each stakeholder type
        Object.entries(rawRewards.reward_gauges || {}).forEach(([stakeholderType, gauge]) => {
            const earned = gauge.coins || [];
            const withdrawn = gauge.withdrawn_coins || [];
            
            // Calculate available rewards (earned - withdrawn)
            const available = earned.map(coin => {
                // Find matching withdrawn coin
                const withdrawnCoin = withdrawn.find(w => w.denom === coin.denom);
                const withdrawnAmount = withdrawnCoin ? BigInt(withdrawnCoin.amount) : BigInt(0);
                const earnedAmount = BigInt(coin.amount);
                
                // Calculate available amount
                const availableAmount = earnedAmount - withdrawnAmount;
                
                return {
                    denom: coin.denom,
                    amount: availableAmount.toString(),
                    display_amount: this.formatTokenAmount(coin.denom, availableAmount.toString())
                };
            }).filter(coin => BigInt(coin.amount) > BigInt(0)); // Only include positive amounts
            
            // Format earned coins
            const formattedEarned = earned.map(coin => ({
                denom: coin.denom,
                amount: coin.amount,
                display_amount: this.formatTokenAmount(coin.denom, coin.amount)
            }));
            
            // Format withdrawn coins
            const formattedWithdrawn = withdrawn.map(coin => ({
                denom: coin.denom,
                amount: coin.amount,
                display_amount: this.formatTokenAmount(coin.denom, coin.amount)
            }));
            
            result[stakeholderType] = {
                earned: formattedEarned,
                withdrawn: formattedWithdrawn,
                available: available
            };
        });
        
        return result;
    }

    /**
     * Format token amount for display based on denom
     * @param denom Token denomination
     * @param amount Raw amount as string
     * @returns Formatted amount for display
     */
    private formatTokenAmount(denom: string, amount: string): string {
        try {
            // Handle different token denominations
            if (denom === 'ubbn') {
                // Convert from micro BBN to BBN (divide by 1,000,000)
                const bbnAmount = Number(amount) / 1_000_000;
                return `${bbnAmount.toFixed(6)} BBN`;
            }
            
            // For other denominations, return as is with denom
            return `${amount} ${denom}`;
        } catch (error) {
            logger.error(`Error formatting token amount for ${denom} ${amount}:`, error);
            return `${amount} ${denom}`;
        }
    }

    /**
     * Get reward statistics for all active finality providers
     * @param network Network to query
     * @returns Summary of rewards for all finality providers
     */
    public async getAllFinalityProviderRewardsSummary(network: Network = Network.MAINNET): Promise<any> {
        const cacheKey = `fp:rewards:summary:${network}`;
        return this.getWithRevalidate(
            cacheKey,
            this.CACHE_TTL.REWARDS_SUMMARY,
            async () => {
                const finalityProviderService = FinalityProviderService.getInstance();
                
                // Log which network we're querying
                logger.info(`[Rewards] Getting rewards summary for network: ${network}`);
                
                // Fetch active providers
                const activeProviders = await finalityProviderService.getActiveFinalityProviders(network);
                logger.info(`[Rewards] Found ${activeProviders.length} active finality providers`);
                
                // If no active providers, return empty map
                if (!activeProviders || activeProviders.length === 0) {
                    logger.warn(`[Rewards] No active finality providers found for network: ${network}`);
                    return { rewards: [] };
                }
                
                // Log the first provider for debugging purposes
                if (activeProviders.length > 0) {
                    logger.info(`[Rewards] First provider sample: ${JSON.stringify(activeProviders[0])}`);
                }
                
                const rewardsArray: any[] = [];
                
                // Process providers in batches to avoid overwhelming the node
                const batchSize = 10;
                const batches = Math.ceil(activeProviders.length / batchSize);
                
                logger.info(`[Rewards] Processing ${activeProviders.length} providers in ${batches} batches`);
                
                for (let i = 0; i < batches; i++) {
                    const start = i * batchSize;
                    const end = Math.min(start + batchSize, activeProviders.length);
                    const batch = activeProviders.slice(start, end);
                    
                    logger.info(`[Rewards] Processing batch ${i+1}/${batches}, providers ${start+1}-${end}`);
                    
                    // Process each provider in the batch
                    const batchResults = await Promise.all(
                        batch.map(async (provider) => {
                            try {
                                // If provider has a Babylon address
                                if (provider.addr) {
                                    logger.info(`[Rewards] Fetching rewards for provider ${provider.btc_pk} with address ${provider.addr}`);
                                    
                                    const rewards = await this.getStakeholderRewards(
                                        provider.addr,
                                        network
                                    );
                                    
                                    logger.info(`[Rewards] Got rewards for provider ${provider.btc_pk}: ${JSON.stringify(Object.keys(rewards.reward_gauges || {}))}`);
                                    
                                    // Return provider info with rewards
                                    return {
                                        btc_pk: provider.btc_pk,
                                        babylon_address: provider.addr,
                                        rewards: this.formatRewards(rewards)
                                    };
                                } else {
                                    logger.warn(`[Rewards] Provider ${provider.btc_pk} has no Babylon address`);
                                    return null;
                                }
                            } catch (error) {
                                logger.error(`[Rewards] Error fetching rewards for provider ${provider.btc_pk}:`, error);
                                // Return provider with empty rewards
                                return {
                                    btc_pk: provider.btc_pk,
                                    babylon_address: provider.addr,
                                    rewards: {}
                                };
                            }
                        })
                    );
                    
                    // Add non-null results to the array
                    rewardsArray.push(...batchResults.filter(r => r !== null));
                    
                    // Add a small delay between batches to avoid rate limiting
                    if (i < batches - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
                
                logger.info(`[Rewards] Final summary contains ${rewardsArray.length} providers with rewards`);
                
                // Return an object with the rewards array
                return { rewards: rewardsArray };
            }
        );
    }
}

// Import here to avoid circular dependencies
import { FinalityProviderService } from './FinalityProviderService';
