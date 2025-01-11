import WebSocket from 'ws';
import { BabylonClient } from '../../clients/BabylonClient';
import { BlockSignatureInfo, SignatureStats, SignatureStatsParams, EpochInfo } from '../../types/finality';

export class FinalitySignatureService {
    private static instance: FinalitySignatureService | null = null;
    private signatureCache: Map<number, Set<string>> = new Map();
    private timestampCache: Map<number, Date> = new Map();
    private ws: WebSocket | null = null;
    private lastProcessedHeight: number = 0;
    private isRunning: boolean = false;
    private readonly MAX_CACHE_SIZE = 1000;
    private readonly RECONNECT_INTERVAL = 5000;
    private readonly UPDATE_INTERVAL = 1000; // Her 1 saniyede bir kontrol et
    private readonly DEFAULT_LAST_N_BLOCKS = 100;
    private readonly MAX_LAST_N_BLOCKS = 200;
    private babylonClient: BabylonClient;
    private updateInterval: NodeJS.Timeout | null = null;
    private epochCache: Map<number, EpochInfo> = new Map();
    private currentEpochInfo: { epochNumber: number; boundary: number } | null = null;

    private constructor() {
        if (!process.env.BABYLON_NODE_URL || !process.env.BABYLON_RPC_URL) {
            throw new Error('BABYLON_NODE_URL and BABYLON_RPC_URL environment variables must be set');
        }
        this.babylonClient = BabylonClient.getInstance(
            process.env.BABYLON_NODE_URL,
            process.env.BABYLON_RPC_URL
        );
    }

    public static getInstance(): FinalitySignatureService {
        if (!FinalitySignatureService.instance) {
            FinalitySignatureService.instance = new FinalitySignatureService();
        }
        return FinalitySignatureService.instance;
    }

    public async start(): Promise<void> {
        if (this.isRunning) return;
        
        console.log('[FinalityService] Starting signature monitoring service...');
        this.isRunning = true;

        // WebSocket bağlantısını başlat
        await this.initializeWebSocket();

        // Periyodik güncelleme işlemini başlat
        this.startPeriodicUpdate();
    }

    public stop(): void {
        console.log('[FinalityService] Stopping signature monitoring service...');
        this.isRunning = false;
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    private startPeriodicUpdate(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        this.updateInterval = setInterval(async () => {
            if (!this.isRunning) return;

            try {
                const currentHeight = await this.babylonClient.getCurrentHeight();
                
                // Son işlenen bloktan current height'e kadar olan eksik blokları işle
                for (let height = this.lastProcessedHeight + 1; height < currentHeight; height++) {
                    await this.fetchAndCacheSignatures(height);
                }
            } catch (error) {
                console.error('[FinalityService] Error in periodic update:', error);
            }
        }, this.UPDATE_INTERVAL);
    }

    private async initializeWebSocket() {
        if (this.ws) {
            console.debug('[WebSocket] Closing existing connection');
            this.ws.close();
        }

        try {
            const currentHeight = await this.babylonClient.getCurrentHeight();
            this.lastProcessedHeight = currentHeight - 1;
            
            console.debug(`[WebSocket] Initializing with current height: ${currentHeight}, processing from: ${this.lastProcessedHeight - 100}`);
            
            // Son birkaç bloğu hemen işle
            for (let height = this.lastProcessedHeight - 100; height <= this.lastProcessedHeight; height++) {
                await this.fetchAndCacheSignatures(height);
            }
        } catch (error) {
            console.error('[WebSocket] Error getting current height:', error);
        }

        console.debug('[WebSocket] Creating new connection');
        this.ws = new WebSocket(this.babylonClient.getWsEndpoint());

        this.ws.on('open', () => {
            console.debug('[WebSocket] Connected successfully');
            this.subscribeToNewBlocks();
        });

        this.ws.on('message', async (data) => {
            if (!this.isRunning) return;

            try {
                const event = JSON.parse(data.toString());
                if (event.type === 'tendermint/event/NewBlock') {
                    const height = parseInt(event.data.value.block.header.height);
                    console.debug(`[WebSocket] 📦 New block received: ${height}, processing signatures for height ${height - 1}`);
                    await this.fetchAndCacheSignatures(height - 1);
                }
            } catch (error) {
                console.error('[WebSocket] Error processing message:', error);
            }
        });

        this.ws.on('close', () => {
            if (this.isRunning) {
                console.debug('[WebSocket] Disconnected, reconnecting...');
                setTimeout(() => this.initializeWebSocket(), this.RECONNECT_INTERVAL);
            }
        });

        this.ws.on('error', (error) => {
            console.error('[WebSocket] Connection error:', error);
        });
    }

    private subscribeToNewBlocks() {
        if (!this.ws) return;

        const subscription = {
            jsonrpc: "2.0",
            method: "subscribe",
            id: "1",
            params: {
                query: "tm.event='NewBlock'"
            }
        };

        this.ws.send(JSON.stringify(subscription));
    }

    private async fetchAndCacheSignatures(height: number) {
        try {
            console.debug(`[Cache] Fetching signatures for finalized block ${height}`);
            const votes = await this.babylonClient.getVotesAtHeight(height);
            const signers = new Set(votes.map(v => v.fp_btc_pk_hex.toLowerCase()));
            
            await this.processBlock(height, signers);
            this.lastProcessedHeight = Math.max(this.lastProcessedHeight, height);
            
            console.debug(`[Cache] ✅ Block ${height} processed, signers: ${signers.size}, cache size: ${this.signatureCache.size}`);
        } catch (error) {
            console.error(`[Cache] ❌ Error processing block ${height}:`, error);
        }
    }

    private async processBlock(height: number, signers: Set<string>): Promise<void> {
        this.signatureCache.set(height, signers);
        this.timestampCache.set(height, new Date());
        
        if (this.signatureCache.size > this.MAX_CACHE_SIZE) {
            const oldestHeight = Math.min(...this.signatureCache.keys());
            this.signatureCache.delete(oldestHeight);
            this.timestampCache.delete(oldestHeight);
        }
    }

    async getSignatureStats(params: SignatureStatsParams): Promise<SignatureStats> {
        const { fpBtcPkHex, startHeight, endHeight, lastNBlocks = this.DEFAULT_LAST_N_BLOCKS } = params;
        
        // lastNBlocks için limit kontrolü
        const limitedLastNBlocks = Math.min(lastNBlocks, this.MAX_LAST_N_BLOCKS);
        
        const currentHeight = await this.babylonClient.getCurrentHeight();
        // Son bloktan bir önceki blok (finalize olmuş son blok)
        const safeHeight = currentHeight - 1;
        
        const actualEndHeight = limitedLastNBlocks 
            ? safeHeight
            : endHeight 
                ? Math.min(endHeight, safeHeight)
                : safeHeight;
            
        const actualStartHeight = limitedLastNBlocks 
            ? safeHeight - limitedLastNBlocks + 1
            : startHeight 
                ? startHeight
                : safeHeight - this.DEFAULT_LAST_N_BLOCKS + 1;

        // Eğer lastNBlocks limiti aşıldıysa uyarı log'u
        if (lastNBlocks > this.MAX_LAST_N_BLOCKS) {
            console.warn(`[Stats] Requested lastNBlocks (${lastNBlocks}) exceeds maximum limit. Using ${this.MAX_LAST_N_BLOCKS} blocks instead.`);
        }

        console.debug(`[Stats] Fetching signature stats from height ${actualStartHeight} to ${actualEndHeight}`);

        // Cache'den eksik blokları kontrol et
        const missingHeights = [];
        for (let height = actualStartHeight; height <= actualEndHeight; height++) {
            if (!this.signatureCache.has(height)) {
                missingHeights.push(height);
            }
        }

        // Eksik blokları getir
        if (missingHeights.length > 0) {
            console.debug(`Fetching ${missingHeights.length} missing blocks`);
            await Promise.all(
                missingHeights.map(height => this.fetchAndCacheSignatures(height))
            );
        }

        return this.calculateStats(fpBtcPkHex, actualStartHeight, actualEndHeight);
    }

    private async calculateStats(
        fpBtcPkHex: string, 
        startHeight: number, 
        endHeight: number
    ): Promise<SignatureStats> {
        const epochInfo = await this.getCurrentEpochInfo();
        const signatureHistory: BlockSignatureInfo[] = [];
        const missedBlockHeights: number[] = [];
        let signedBlocks = 0;
        let unknownBlocks = 0;
        const normalizedPk = fpBtcPkHex.toLowerCase();
        const epochStats: { [key: number]: any } = {};

        const blocksPerEpoch = 360;
        const currentEpochStart = epochInfo.boundary - blocksPerEpoch + 1;
        
        for (let height = startHeight; height <= endHeight; height++) {
            const signers = this.signatureCache.get(height);
            const timestamp = this.timestampCache.get(height) || new Date();
            
            const heightEpoch = epochInfo.epochNumber + Math.floor((height - currentEpochStart) / blocksPerEpoch);

            if (!signers) {
                console.warn(`[Stats] No signature data for height ${height}, marking as unknown`);
                unknownBlocks++;
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
            } else {
                missedBlockHeights.push(height);
            }
            
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
            
            if (signers === undefined) {
                currentEpochStats.unknownBlocks++;
            } else if (hasSigned) {
                currentEpochStats.signedBlocks++;
            } else {
                currentEpochStats.missedBlocks++;
            }

            const validBlocks = currentEpochStats.totalBlocks - currentEpochStats.unknownBlocks;
            currentEpochStats.signatureRate = validBlocks > 0 
                ? (currentEpochStats.signedBlocks / validBlocks) * 100 
                : 0;

            signatureHistory.push({
                height,
                signed: hasSigned,
                status: hasSigned ? 'signed' : (signers === undefined ? 'unknown' : 'missed'),
                epochNumber: heightEpoch,
                timestamp
            });
        }

        const validBlocks = endHeight - startHeight + 1 - unknownBlocks;
        
        return {
            fp_btc_pk_hex: fpBtcPkHex,
            startHeight,
            endHeight,
            currentHeight: this.lastProcessedHeight,
            totalBlocks: endHeight - startHeight + 1,
            signedBlocks,
            missedBlocks: validBlocks - signedBlocks,
            unknownBlocks,
            signatureRate: validBlocks > 0 ? (signedBlocks / validBlocks) * 100 : 0,
            missedBlockHeights,
            signatureHistory,
            epochStats,
            lastSignedBlock: signatureHistory
                .filter(block => block.signed)
                .sort((a, b) => b.height - a.height)[0]
        };
    }

    private async getCurrentEpochInfo(): Promise<{ epochNumber: number; boundary: number }> {
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

    private async calculateEpochForHeight(height: number): Promise<EpochInfo> {
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
} 