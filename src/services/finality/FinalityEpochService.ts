import { BabylonClient } from '../../clients/BabylonClient';
import { Network } from '../../types/finality';
import { EpochInfo, EpochStats, SignatureStatsParams } from '../../types';
import { FinalityProviderService } from './FinalityProviderService';
import { logger } from '../../utils/logger';

export class FinalityEpochService {
    private static instance: FinalityEpochService | null = null;
    private babylonClient: BabylonClient;
    private finalityProviderService: FinalityProviderService;
    private currentEpochInfo: { epochNumber: number; boundary: number } | null = null;
    private epochCache: Map<number, EpochInfo> = new Map();
    private currentEpochStatsCache: {
        stats: EpochStats;
        timestamp: number;
    } | null = null;

    // Default network type to be used (one of the configured networks)
    private defaultNetwork: Network;
    
    private readonly EPOCHS_TO_KEEP = 14; // Keep last 14 epochs
    private readonly statsUpdateLock: Set<string> = new Set();
    private readonly STATS_UPDATE_INTERVAL = 60000; // 1 minute

    private constructor() {
        // First, determine the configured networks
        this.defaultNetwork = this.determineDefaultNetwork();
        // Get BabylonClient based on the determined default network
        this.babylonClient = BabylonClient.getInstance(this.defaultNetwork);
        this.finalityProviderService = FinalityProviderService.getInstance();
        logger.info(`[FinalityEpochService] Initialized with default network: ${this.defaultNetwork}`);
    }

    /**
     * Sets one of the configured networks as default.
     * Checks testnet first, then mainnet.
     */
    private determineDefaultNetwork(): Network {
        try {
            // try testnet first
            try {
                const testnetClient = BabylonClient.getInstance(Network.TESTNET);
                const testnetBaseUrl = testnetClient.getBaseUrl();
                if (testnetBaseUrl) {
                    logger.info('[FinalityEpochService] Using TESTNET as default network');
                    return Network.TESTNET;
                }
            } catch (err) {
                logger.debug(`[FinalityEpochService] Testnet not available: ${err instanceof Error ? err.message : String(err)}`);
            }
            
            // If testnet is not available, try mainnet
            try {
                const mainnetClient = BabylonClient.getInstance(Network.MAINNET);
                const mainnetBaseUrl = mainnetClient.getBaseUrl();
                if (mainnetBaseUrl) {
                    logger.info('[FinalityEpochService] Using MAINNET as default network');
                    return Network.MAINNET;
                }
            } catch (err) {
                logger.debug(`[FinalityEpochService] Mainnet not available: ${err instanceof Error ? err.message : String(err)}`);
            }
            
            // Return testnet as default (even if not configured, will be checked later)
            logger.warn('[FinalityEpochService] No configured networks found, defaulting to MAINNET');
            return Network.MAINNET;
        } catch (err) {
            logger.error(`[FinalityEpochService] Error determining default network: ${err instanceof Error ? err.message : String(err)}`);
            // As a last resort, return testnet
            return Network.MAINNET;
        }
    }
    
    /**
     * Checks if the specified network is configured.
     * If the network is not configured, uses the default network.
     */
    private ensureNetworkConfigured(network: Network): Network {
        try {
            const client = BabylonClient.getInstance(network);
            const baseUrl = client.getBaseUrl();
            if (baseUrl) {
                return network;
            }
        } catch (err) {
            logger.warn(`[FinalityEpochService] Network ${network} is not configured, using default network ${this.defaultNetwork} instead`);
        }
        return this.defaultNetwork;
    }

    public static getInstance(): FinalityEpochService {
        if (!FinalityEpochService.instance) {
            FinalityEpochService.instance = new FinalityEpochService();
        }
        return FinalityEpochService.instance;
    }

    public async getCurrentEpochInfo(network?: Network): Promise<{ epochNumber: number; boundary: number }> {
        // Make sure the specified network is configured, if not use the default
        const useNetwork = network ? this.ensureNetworkConfigured(network) : this.defaultNetwork;
        
        if (this.currentEpochInfo) {
            return this.currentEpochInfo;
        }
        
        const client = BabylonClient.getInstance(useNetwork);
        const response = await client.getCurrentEpoch();
        this.currentEpochInfo = {
            epochNumber: Number(response.current_epoch),
            boundary: Number(response.epoch_boundary)
        };

        return this.currentEpochInfo;
    }

    public async checkAndUpdateEpoch(currentHeight: number, network?: Network): Promise<void> {
        // Make sure the specified network is configured, if not use the default
        const useNetwork = network ? this.ensureNetworkConfigured(network) : this.defaultNetwork;
        
        try {
            // If cache doesn't exist or current height has passed the boundary
            if (!this.currentEpochInfo || currentHeight > this.currentEpochInfo.boundary) {
                const client = BabylonClient.getInstance(useNetwork);
                const response = await client.getCurrentEpoch();
                const newEpochInfo = {
                    epochNumber: Number(response.current_epoch),
                    boundary: Number(response.epoch_boundary)
                };

                // If we have moved to a new epoch
                if (!this.currentEpochInfo || newEpochInfo.epochNumber > this.currentEpochInfo.epochNumber) {
                    this.currentEpochInfo = newEpochInfo;
                    await this.cleanupOldEpochs();
                    logger.info(`[FinalityEpochService] Moved to new epoch ${newEpochInfo.epochNumber} with boundary ${newEpochInfo.boundary} on network ${useNetwork}`);
                }
            }
        } catch (error) {
            logger.error(`[FinalityEpochService] Error updating epoch info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async cleanupOldEpochs(): Promise<void> {
        if (!this.currentEpochInfo) return;

        const currentEpoch = this.currentEpochInfo.epochNumber;
        const oldestEpochToKeep = currentEpoch - this.EPOCHS_TO_KEEP;

        // Get all heights from cache
        const heights = Array.from(this.epochCache.keys());

        // Remove entries for epochs older than oldestEpochToKeep
        for (const height of heights) {
            const epochInfo = this.epochCache.get(height);
            if (epochInfo && epochInfo.epochNumber < oldestEpochToKeep) {
                this.epochCache.delete(height);
            }
        }

        logger.debug(`[EpochService] Cleaned up epochs older than ${oldestEpochToKeep}, current cache size: ${this.epochCache.size}`);
    }

    public async calculateEpochForHeight(height: number): Promise<EpochInfo> {
        // Check cache first
        const cachedEpoch = this.epochCache.get(height);
        if (cachedEpoch) {
            return cachedEpoch;
        }

        const epochInfo = await this.getCurrentEpochInfo();
        const epochNumber = Math.floor(height / epochInfo.boundary);
        
        const epochData = {
            epochNumber,
            startHeight: epochNumber * epochInfo.boundary,
            endHeight: (epochNumber + 1) * epochInfo.boundary - 1
        };

        // Cache the result
        this.epochCache.set(height, epochData);
        
        return epochData;
    }

    public async updateCurrentEpochStats(
        getSignatureStats: (params: SignatureStatsParams) => Promise<any>,
        network?: Network
    ): Promise<EpochStats> {
        // Make sure the specified network is configured, if not use the default
        const useNetwork = network ? this.ensureNetworkConfigured(network) : this.defaultNetwork;
        
        const lockKey = `epoch-stats-${useNetwork}`;
        
        // Check if stats are being updated
        if (this.statsUpdateLock.has(lockKey)) {
            if (this.currentEpochStatsCache) {
                return this.currentEpochStatsCache.stats;
            }
            throw new Error('Epoch stats are being updated');
        }

        // Check if cache is still valid
        if (this.currentEpochStatsCache && 
            Date.now() - this.currentEpochStatsCache.timestamp < this.STATS_UPDATE_INTERVAL) {
            return this.currentEpochStatsCache.stats;
        }

        try {
            this.statsUpdateLock.add(lockKey);
            
            const client = BabylonClient.getInstance(useNetwork);
            const currentEpoch = await this.getCurrentEpochInfo(useNetwork);
            const currentHeight = await client.getCurrentHeight();
            const safeHeight = currentHeight - 2; // Process up to 2 blocks behind (because there is a timeout for the finality providers to submit their votes)
            
            // Calculate epoch boundaries
            const epochStartHeight = currentEpoch.boundary - 360; // Each epoch is 360 blocks
            const epochEndHeight = Math.min(currentEpoch.boundary);
            
            // Get active finality providers at current height
            const providers = await client.getActiveFinalityProvidersAtHeight(safeHeight);
            
            // Calculate stats for each provider
            const providerStats = await Promise.all(
                providers
                    .filter(provider => !provider.jailed && provider.highestVotedHeight > 0)
                    .map(async (provider) => {
                        const stats = await getSignatureStats({
                            fpBtcPkHex: provider.fpBtcPkHex,
                            startHeight: epochStartHeight,
                            endHeight: epochEndHeight,
                            network: useNetwork
                        });
                        
                        const totalBlocks = stats.signedBlocks + stats.missedBlocks;
                        return {
                            btcPk: provider.fpBtcPkHex,
                            signedBlocks: stats.signedBlocks,
                            missedBlocks: stats.missedBlocks,
                            successRate: totalBlocks > 0 ? (stats.signedBlocks / totalBlocks * 100) : 0,
                            votingPower: provider.votingPower
                        };
                    })
            );

            // Sort providers by voting power in descending order
            providerStats.sort((a, b) => parseInt(b.votingPower) - parseInt(a.votingPower));

            // Create stats object
            const epochStats: EpochStats = {
                epochNumber: currentEpoch.epochNumber,
                startHeight: epochStartHeight,
                currentHeight: safeHeight,
                endHeight: epochEndHeight,
                providerStats,
                timestamp: Date.now()
            };

            // Save to cache
            this.currentEpochStatsCache = {
                stats: epochStats,
                timestamp: Date.now()
            };

            logger.debug(`[Stats] Updated epoch ${currentEpoch.epochNumber} stats with ${providerStats.length} providers`);
            
            return epochStats;
        } catch (error) {
            logger.error('Error updating current epoch stats:', error);
            throw error;
        } finally {
            this.statsUpdateLock.delete(lockKey);
        }
    }

    public async getCurrentEpochStats(network?: Network): Promise<EpochStats> {
        // Make sure the specified network is configured, if not use the default
        const useNetwork = network ? this.ensureNetworkConfigured(network) : this.defaultNetwork;
        
        if (!this.currentEpochStatsCache) {
            throw new Error('Epoch stats not initialized');
        }
        return this.currentEpochStatsCache.stats;
    }

    public async getProviderCurrentEpochStats(
        fpBtcPkHex: string, 
        getSignatureStats: (params: SignatureStatsParams) => Promise<any>,
        network?: Network
    ): Promise<{
        epochNumber: number;
        startHeight: number;
        currentHeight: number;
        endHeight: number;
        signedBlocks: number;
        missedBlocks: number;
        successRate: number;
        timestamp: number;
    }> {
        try {
            // Make sure the specified network is configured, if not use the default
            const useNetwork = network ? this.ensureNetworkConfigured(network) : this.defaultNetwork;
            
            const client = BabylonClient.getInstance(useNetwork);
            const currentEpoch = await this.getCurrentEpochInfo(useNetwork);
            const currentHeight = await client.getCurrentHeight();
            const epochStartHeight = currentEpoch.boundary - 360;
            const epochEndHeight = currentEpoch.boundary;

            const stats = await getSignatureStats({
                fpBtcPkHex,
                startHeight: epochStartHeight,
                endHeight: epochEndHeight,
                network: useNetwork
            });

            const totalBlocks = stats.signedBlocks + stats.missedBlocks;
            
            return {
                epochNumber: currentEpoch.epochNumber,
                startHeight: epochStartHeight,
                currentHeight,
                endHeight: epochEndHeight,
                signedBlocks: stats.signedBlocks,
                missedBlocks: stats.missedBlocks,
                successRate: totalBlocks > 0 ? (stats.signedBlocks / totalBlocks * 100) : 0,
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error(`[FinalityEpochService] Error getting current epoch stats for provider ${fpBtcPkHex}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
} 