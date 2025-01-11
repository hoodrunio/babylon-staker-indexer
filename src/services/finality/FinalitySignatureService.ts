import WebSocket from 'ws';
import { BabylonClient } from '../../clients/BabylonClient';
import { BlockSignatureInfo, SignatureStats, SignatureStatsParams } from '../../types/finality';

export class FinalitySignatureService {
    private static instance: FinalitySignatureService | null = null;
    private signatureCache: Map<number, Set<string>> = new Map();
    private ws: WebSocket | null = null;
    private lastProcessedHeight: number = 0;
    private isRunning: boolean = false;
    private readonly MAX_CACHE_SIZE = 1000;
    private readonly RECONNECT_INTERVAL = 5000;
    private readonly UPDATE_INTERVAL = 1000; // Her 1 saniyede bir kontrol et
    private babylonClient: BabylonClient;
    private updateInterval: NodeJS.Timeout | null = null;

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
            
            this.signatureCache.set(height, signers);
            this.lastProcessedHeight = Math.max(this.lastProcessedHeight, height);
            
            this.cleanOldCache(height);
            
            console.debug(`[Cache] ✅ Block ${height} processed, signers: ${signers.size}, cache size: ${this.signatureCache.size}`);
        } catch (error) {
            console.error(`[Cache] ❌ Error processing block ${height}:`, error);
        }
    }

    private cleanOldCache(currentHeight: number) {
        if (this.signatureCache.size > this.MAX_CACHE_SIZE) {
            const minHeight = currentHeight - this.MAX_CACHE_SIZE;
            for (const [height] of this.signatureCache) {
                if (height < minHeight) {
                    this.signatureCache.delete(height);
                }
            }
        }
    }

    async getSignatureStats(params: SignatureStatsParams): Promise<SignatureStats> {
        const { fpBtcPkHex, startHeight, endHeight, lastNBlocks } = params;
        
        const currentHeight = await this.babylonClient.getCurrentHeight();
        // Son bloktan bir önceki blok (finalize olmuş son blok)
        const safeHeight = currentHeight - 1;
        
        const actualEndHeight = lastNBlocks 
            ? safeHeight
            : endHeight 
                ? Math.min(endHeight, safeHeight)
                : safeHeight;
            
        const actualStartHeight = lastNBlocks 
            ? safeHeight - lastNBlocks + 1
            : startHeight 
                ? startHeight
                : safeHeight - 100 + 1;

        console.debug(`Fetching signature stats from height ${actualStartHeight} to ${actualEndHeight}`);

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
        const signatureHistory: BlockSignatureInfo[] = [];
        const missedBlockHeights: number[] = [];
        let signedBlocks = 0;
        const normalizedPk = fpBtcPkHex.toLowerCase();
        const epochStats: { [key: number]: any } = {};

        for (let height = startHeight; height <= endHeight; height++) {
            const signers = this.signatureCache.get(height);
            if (!signers) {
                console.warn(`No signature data for height ${height}`);
                continue;
            }

            const hasSigned = signers.has(normalizedPk);
            if (hasSigned) {
                signedBlocks++;
            } else {
                missedBlockHeights.push(height);
            }

            const epochInfo = await this.babylonClient.calculateEpochForHeight(height);
            
            if (!epochStats[epochInfo.epochNumber]) {
                epochStats[epochInfo.epochNumber] = {
                    totalBlocks: 0,
                    signedBlocks: 0,
                    missedBlocks: 0,
                    signatureRate: 0,
                    firstBlockHeight: epochInfo.startHeight,
                    epochInterval: epochInfo.interval
                };
            }

            const currentEpochStats = epochStats[epochInfo.epochNumber];
            currentEpochStats.totalBlocks++;
            if (hasSigned) {
                currentEpochStats.signedBlocks++;
            } else {
                currentEpochStats.missedBlocks++;
            }
            currentEpochStats.signatureRate = 
                (currentEpochStats.signedBlocks / currentEpochStats.totalBlocks) * 100;

            signatureHistory.push({
                height,
                signed: hasSigned,
                epochNumber: epochInfo.epochNumber,
                timestamp: new Date() // TODO: Block timestamp eklenecek
            });
        }

        const totalBlocks = endHeight - startHeight + 1;
        return {
            fp_btc_pk_hex: fpBtcPkHex,
            startHeight,
            endHeight,
            currentHeight: this.lastProcessedHeight,
            totalBlocks,
            signedBlocks,
            missedBlocks: totalBlocks - signedBlocks,
            signatureRate: (signedBlocks / totalBlocks) * 100,
            missedBlockHeights,
            signatureHistory,
            epochStats,
            lastSignedBlock: signatureHistory
                .filter(block => block.signed)
                .sort((a, b) => b.height - a.height)[0]
        };
    }
} 