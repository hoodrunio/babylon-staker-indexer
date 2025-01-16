import { BabylonClient } from '../../clients/BabylonClient';
import { 
    BlockSignatureInfo, 
    SignatureStats, 
    SignatureStatsParams,
    EpochStats
} from '../../types';
import { Response } from 'express';
import { Network } from '../../api/middleware/network-selector';
import { FinalityHistoricalService } from './FinalityHistoricalService';
import { FinalityEpochService } from './FinalityEpochService';
import { FinalitySSEManager } from './FinalitySSEManager';
import { FinalityCacheManager } from './FinalityCacheManager';
import { FinalityWebSocketManager } from './FinalityWebSocketManager';
import { FinalityBlockProcessor } from './FinalityBlockProcessor';

export class FinalitySignatureService {
    private static instance: FinalitySignatureService | null = null;
    private readonly DEFAULT_LAST_N_BLOCKS = 100;
    private readonly MAX_LAST_N_BLOCKS = 5000;
    private babylonClient: BabylonClient;
    private historicalService: FinalityHistoricalService;
    private epochService: FinalityEpochService;
    private sseManager: FinalitySSEManager;
    private cacheManager: FinalityCacheManager;
    private wsManager: FinalityWebSocketManager;
    private blockProcessor: FinalityBlockProcessor;
    private missingBlocksCache: Map<string, boolean> = new Map();
    private processingRanges: Set<string> = new Set();
    private readonly CACHE_TTL = 60000; // 30 seconds TTL for cache
    private readonly globalProcessedRanges: Map<string, number> = new Map();
    private readonly missingBlocksLogCache: Map<string, number> = new Map();

    private constructor() {
        if (!process.env.BABYLON_NODE_URL || !process.env.BABYLON_RPC_URL) {
            throw new Error('BABYLON_NODE_URL and BABYLON_RPC_URL environment variables must be set');
        }
        this.babylonClient = BabylonClient.getInstance(
            process.env.BABYLON_NODE_URL,
            process.env.BABYLON_RPC_URL
        );
        this.historicalService = FinalityHistoricalService.getInstance();
        this.epochService = FinalityEpochService.getInstance();
        this.sseManager = FinalitySSEManager.getInstance();
        this.cacheManager = FinalityCacheManager.getInstance();
        this.wsManager = FinalityWebSocketManager.getInstance();
        this.blockProcessor = FinalityBlockProcessor.getInstance();

        // Set up WebSocket callback
        this.wsManager.setNewBlockCallback(async (height) => {
            await this.blockProcessor.handleNewBlock(height);
        });

        // Set this service in block processor
        this.blockProcessor.setSignatureService(this);
    }

    public static getInstance(): FinalitySignatureService {
        if (!FinalitySignatureService.instance) {
            FinalitySignatureService.instance = new FinalitySignatureService();
        }
        return FinalitySignatureService.instance;
    }

    private getNetworkConfig(network: Network = Network.MAINNET) {
        return {
            nodeUrl: network === Network.MAINNET ? process.env.BABYLON_NODE_URL : process.env.BABYLON_TESTNET_NODE_URL,
            rpcUrl: network === Network.MAINNET ? process.env.BABYLON_RPC_URL : process.env.BABYLON_TESTNET_RPC_URL
        };
    }

    public async start(): Promise<void> {
        console.log('[FinalityService] Starting signature monitoring service...');
        
        // Start block processor
        await this.blockProcessor.start();
        
        // Initialize from last 100 blocks
        const currentHeight = await this.babylonClient.getCurrentHeight();
        const startHeight = currentHeight - this.DEFAULT_LAST_N_BLOCKS;
        await this.blockProcessor.initializeFromHeight(startHeight);
        
        // Initialize epoch stats
        await this.epochService.updateCurrentEpochStats(
            this.getSignatureStats.bind(this)
        );
        
        // Start WebSocket
        await this.wsManager.start();
    }

    public stop(): void {
        console.log('[FinalityService] Stopping signature monitoring service...');
        this.blockProcessor.stop();
        this.wsManager.stop();
    }

    public async addSSEClient(clientId: string, res: Response, fpBtcPkHex: string): Promise<void> {
        const currentHeight = this.blockProcessor.getLastProcessedHeight() + 2;
        await this.sseManager.addClient(
            clientId,
            res,
            fpBtcPkHex,
            this.getSignatureStats.bind(this),
            currentHeight
        );
    }

    private async checkAndProcessMissingBlocks(fetchStartHeight: number, actualEndHeight: number, currentHeight: number): Promise<void> {
        const cacheKey = `${fetchStartHeight}-${actualEndHeight}`;
        
        // Check global cache first
        const globalCacheTimestamp = this.globalProcessedRanges.get(cacheKey);
        if (globalCacheTimestamp && Date.now() - globalCacheTimestamp < this.CACHE_TTL) {
            return;
        }

        // Return if this range is currently being processed by another call
        if (this.processingRanges.has(cacheKey)) {
            return;
        }

        try {
            this.processingRanges.add(cacheKey);

            const missingHeights = [];
            let missingCount = 0;
            
            for (let height = fetchStartHeight; height <= actualEndHeight; height++) {
                if (!this.cacheManager.hasSignatureData(height) && 
                    !this.blockProcessor.isProcessing(height) &&
                    currentHeight > height + 2) {
                    missingHeights.push(height);
                    missingCount++;
                }
            }

            if (missingCount > 0) {
                console.debug(`[Stats] ${missingCount} blocks have no signature data in the range ${fetchStartHeight}-${actualEndHeight}`);
                // Process blocks sequentially to avoid duplicate requests
                for (const height of missingHeights) {
                    await this.blockProcessor.fetchAndCacheSignatures(height);
                }
            }

            // Update both caches
            this.missingBlocksCache.set(cacheKey, true);
            this.globalProcessedRanges.set(cacheKey, Date.now());

            // Clean up old entries from global cache
            const now = Date.now();
            for (const [key, timestamp] of this.globalProcessedRanges.entries()) {
                if (now - timestamp > this.CACHE_TTL) {
                    this.globalProcessedRanges.delete(key);
                }
            }
        } finally {
            this.processingRanges.delete(cacheKey);
        }
    }

    private normalizeRange(start: number, end: number): { start: number, end: number } {
        // Normalize to 100-block intervals
        const intervalSize = this.DEFAULT_LAST_N_BLOCKS;
        const normalizedStart = Math.floor(start / intervalSize) * intervalSize;
        const normalizedEnd = Math.ceil(end / intervalSize) * intervalSize;
        return { start: normalizedStart, end: normalizedEnd };
    }

    private async batchProcessMissingBlocks(startHeight: number, endHeight: number, currentHeight: number): Promise<void> {
        // Normalize range to reduce unique ranges
        const { start, end } = this.normalizeRange(startHeight, endHeight);
        await this.checkAndProcessMissingBlocks(start, end, currentHeight);
    }

    public async getSignatureStats(params: SignatureStatsParams): Promise<SignatureStats> {
        const { nodeUrl, rpcUrl } = this.getNetworkConfig(params.network);
        const { fpBtcPkHex, startHeight, endHeight, lastNBlocks = this.DEFAULT_LAST_N_BLOCKS } = params;
        
        const currentHeight = await this.babylonClient.getCurrentHeight();
        // Last processed block (2 blocks behind current height)
        const safeHeight = currentHeight - 2;

        let actualEndHeight = endHeight 
            ? Math.min(endHeight, safeHeight)
            : safeHeight;
            
        let actualStartHeight;
        if (startHeight) {
            actualStartHeight = startHeight;
        } else if (lastNBlocks === this.DEFAULT_LAST_N_BLOCKS) {
            // Last 100 blocks for /stats endpoint
            actualStartHeight = Math.max(1, actualEndHeight - lastNBlocks + 1);
        } else {
            // Start from oldest cached block for /performance endpoint
            actualStartHeight = Math.max(1, actualEndHeight - this.MAX_LAST_N_BLOCKS + 1);
        }

        // Only fetch last 100 blocks for /stats endpoint
        if (lastNBlocks === this.DEFAULT_LAST_N_BLOCKS) {
            const fetchStartHeight = Math.max(actualStartHeight, actualEndHeight - this.DEFAULT_LAST_N_BLOCKS + 1);
            await this.batchProcessMissingBlocks(fetchStartHeight, actualEndHeight, currentHeight);
        }

        // Calculate stats
        const stats = await this.calculateStats(
            fpBtcPkHex,
            actualStartHeight,
            actualEndHeight
        );

        // Set actual metrics
        stats.totalBlocks = actualEndHeight - actualStartHeight + 1;
        stats.startHeight = actualStartHeight;
        stats.endHeight = actualEndHeight;
        stats.currentHeight = currentHeight;

        // Recalculate unknown blocks
        stats.unknownBlocks = stats.totalBlocks - (stats.signedBlocks + stats.missedBlocks);

        // Recalculate success rate
        const signableBlocks = stats.signedBlocks + stats.missedBlocks;
        stats.signatureRate = signableBlocks > 0 ? (stats.signedBlocks / signableBlocks) * 100 : 0;

        return stats;
    }

    private async calculateStats(
        fpBtcPkHex: string, 
        startHeight: number, 
        endHeight: number
    ): Promise<SignatureStats> {
        const epochInfo = await this.epochService.getCurrentEpochInfo();
        const signatureHistory: BlockSignatureInfo[] = [];
        const missedBlockHeights: number[] = [];
        let signedBlocks = 0;
        let missedBlocks = 0;
        let unknownBlocks = 0;
        const normalizedPk = fpBtcPkHex.toLowerCase();
        const epochStats: { [key: number]: any } = {};

        const blocksPerEpoch = 360;
        const currentEpochStart = epochInfo.boundary - blocksPerEpoch + 1;

        // Check if we've logged this range recently
        const rangeKey = `${startHeight}-${endHeight}`;
        const lastLogTime = this.missingBlocksLogCache.get(rangeKey);
        const shouldLog = !lastLogTime || (Date.now() - lastLogTime > this.CACHE_TTL);

        // Calculate missing blocks only if we should log
        if (shouldLog) {
            const missingBlocksCount = Array.from({ length: endHeight - startHeight + 1 }, (_, i) => startHeight + i)
                .filter(height => !this.cacheManager.hasSignatureData(height))
                .length;

            if (missingBlocksCount > 0) {
                console.debug(`[Stats] ${missingBlocksCount} blocks have no signature data in the range ${startHeight}-${endHeight}`);
                this.missingBlocksLogCache.set(rangeKey, Date.now());

                // Clean up old cache entries
                const now = Date.now();
                for (const [key, timestamp] of this.missingBlocksLogCache.entries()) {
                    if (now - timestamp > this.CACHE_TTL) {
                        this.missingBlocksLogCache.delete(key);
                    }
                }
            }
        }
        
        for (let height = startHeight; height <= endHeight; height++) {
            const signers = this.cacheManager.getSigners(height);
            const timestamp = this.cacheManager.getTimestamp(height) || new Date();
            
            const heightEpoch = epochInfo.epochNumber + Math.floor((height - currentEpochStart) / blocksPerEpoch);

            if (!epochStats[heightEpoch]) {
                const isCurrentEpoch = heightEpoch === epochInfo.epochNumber;
                const epochStartHeight = isCurrentEpoch ? 
                    currentEpochStart : 
                    epochInfo.boundary + ((heightEpoch - epochInfo.epochNumber - 1) * blocksPerEpoch) + 1;
                
                const epochEndHeight = isCurrentEpoch ? 
                    epochInfo.boundary : 
                    epochStartHeight + blocksPerEpoch - 1;
                
                epochStats[heightEpoch] = {
                    totalBlocks: 0,
                    signedBlocks: 0,
                    missedBlocks: 0,
                    unknownBlocks: 0,
                    signatureRate: 0,
                    startHeight: epochStartHeight,
                    endHeight: epochEndHeight
                };
            }

            const currentEpochStats = epochStats[heightEpoch];
            currentEpochStats.totalBlocks++;

            if (!signers || signers.size === 0) {
                unknownBlocks++;
                currentEpochStats.unknownBlocks++;
                signatureHistory.push({
                    height,
                    signed: false,
                    status: 'unknown',
                    epochNumber: heightEpoch,
                    timestamp
                });
                continue;
            }

            const hasSigned = signers.has(normalizedPk);
            if (hasSigned) {
                signedBlocks++;
                currentEpochStats.signedBlocks++;
                signatureHistory.push({
                    height,
                    signed: true,
                    status: 'signed',
                    epochNumber: heightEpoch,
                    timestamp
                });
            } else {
                missedBlocks++;
                currentEpochStats.missedBlocks++;
                missedBlockHeights.push(height);
                signatureHistory.push({
                    height,
                    signed: false,
                    status: 'missed',
                    epochNumber: heightEpoch,
                    timestamp
                });
            }

            const signableBlocks = currentEpochStats.signedBlocks + currentEpochStats.missedBlocks;
            currentEpochStats.signatureRate = signableBlocks > 0 
                ? (currentEpochStats.signedBlocks / signableBlocks) * 100 
                : 0;
        }

        const relevantEpochs = new Set(signatureHistory.map(s => s.epochNumber));
        Object.keys(epochStats).forEach(epoch => {
            if (!relevantEpochs.has(Number(epoch))) {
                delete epochStats[Number(epoch)];
            }
        });
        
        return {
            fp_btc_pk_hex: fpBtcPkHex,
            startHeight,
            endHeight,
            currentHeight: this.blockProcessor.getLastProcessedHeight(),
            totalBlocks: endHeight - startHeight + 1,
            signedBlocks,
            missedBlocks,
            unknownBlocks,
            signatureRate: 0,
            missedBlockHeights,
            signatureHistory,
            epochStats,
            lastSignedBlock: signatureHistory
                .filter(block => block.signed)
                .sort((a, b) => b.height - a.height)[0]
        };
    }

    public async getCurrentHeight(): Promise<number> {
        return this.babylonClient.getCurrentHeight();
    }
} 