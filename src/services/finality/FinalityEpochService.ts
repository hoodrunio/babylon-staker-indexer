import { BabylonClient } from '../../clients/BabylonClient';
import { Network } from '../../api/middleware/network-selector';
import { EpochInfo, EpochStats, SignatureStatsParams } from '../../types';

export class FinalityEpochService {
    private static instance: FinalityEpochService | null = null;
    private babylonClient: BabylonClient;
    private currentEpochInfo: { epochNumber: number; boundary: number } | null = null;
    private epochCache: Map<number, EpochInfo> = new Map();
    private currentEpochStatsCache: {
        stats: EpochStats;
        timestamp: number;
    } | null = null;
    private readonly EPOCH_STATS_CACHE_TTL = 10000; // 10 seconds

    private constructor() {
        if (!process.env.BABYLON_NODE_URL || !process.env.BABYLON_RPC_URL) {
            throw new Error('BABYLON_NODE_URL and BABYLON_RPC_URL environment variables must be set');
        }
        this.babylonClient = BabylonClient.getInstance(
            process.env.BABYLON_NODE_URL,
            process.env.BABYLON_RPC_URL
        );
    }

    public static getInstance(): FinalityEpochService {
        if (!FinalityEpochService.instance) {
            FinalityEpochService.instance = new FinalityEpochService();
        }
        return FinalityEpochService.instance;
    }

    public async getCurrentEpochInfo(): Promise<{ epochNumber: number; boundary: number }> {
        if (this.currentEpochInfo) {
            return this.currentEpochInfo;
        }
        
        const response = await this.babylonClient.getCurrentEpoch();
        this.currentEpochInfo = {
            epochNumber: Number(response.current_epoch),
            boundary: Number(response.epoch_boundary)
        };
        return this.currentEpochInfo;
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
        network: Network = Network.MAINNET
    ): Promise<void> {
        try {
            const currentEpoch = await this.getCurrentEpochInfo();
            const currentHeight = await this.babylonClient.getCurrentHeight();
            
            // Calculate epoch boundaries
            const epochStartHeight = currentEpoch.boundary - 360; // Each epoch is 360 blocks
            
            // Get all finality providers
            const providers = await this.babylonClient.getAllFinalityProviders(network);
            
            // Calculate stats for each provider
            const providerStats = await Promise.all(
                providers
                    .filter(provider => provider.fpBtcPkHex)
                    .map(async (provider) => {
                        const stats = await getSignatureStats({
                            fpBtcPkHex: provider.fpBtcPkHex,
                            startHeight: epochStartHeight,
                            endHeight: currentHeight,
                            network
                        });
                        
                        const totalBlocks = stats.signedBlocks + stats.missedBlocks;
                        return {
                            btcPk: provider.fpBtcPkHex,
                            signedBlocks: stats.signedBlocks,
                            missedBlocks: stats.missedBlocks,
                            successRate: totalBlocks > 0 ? (stats.signedBlocks / totalBlocks * 100) : 0
                        };
                    })
            );

            // Save to cache
            this.currentEpochStatsCache = {
                stats: {
                    epochNumber: currentEpoch.epochNumber,
                    startHeight: epochStartHeight,
                    currentHeight,
                    providerStats,
                    timestamp: Date.now()
                },
                timestamp: Date.now()
            };

            console.debug(`[Stats] Updated epoch ${currentEpoch.epochNumber} stats with ${providerStats.length} providers`);
        } catch (error) {
            console.error('Error updating current epoch stats:', error);
        }
    }

    public async getCurrentEpochStats(network: Network = Network.MAINNET): Promise<EpochStats> {
        if (!this.currentEpochStatsCache) {
            throw new Error('Epoch stats not initialized');
        }
        return this.currentEpochStatsCache.stats;
    }

    public async getProviderCurrentEpochStats(
        fpBtcPkHex: string, 
        getSignatureStats: (params: SignatureStatsParams) => Promise<any>,
        network: Network = Network.MAINNET
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
            const currentEpoch = await this.getCurrentEpochInfo();
            const currentHeight = await this.babylonClient.getCurrentHeight();
            const epochStartHeight = currentEpoch.boundary - 360;
            const epochEndHeight = currentEpoch.boundary;

            const stats = await getSignatureStats({
                fpBtcPkHex,
                startHeight: epochStartHeight,
                endHeight: epochEndHeight,
                network
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
            console.error(`Error getting current epoch stats for provider ${fpBtcPkHex}:`, error);
            throw error;
        }
    }
} 