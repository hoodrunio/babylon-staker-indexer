import WebSocket from 'ws';
import { BabylonClient } from '../../clients/BabylonClient';
import { BlockSignatureInfo, SignatureStats, SignatureStatsParams, EpochInfo } from '../../types/finality';
import { Response } from 'express';

export class FinalitySignatureService {
    private static instance: FinalitySignatureService | null = null;
    private signatureCache: Map<number, Set<string>> = new Map();
    private timestampCache: Map<number, Date> = new Map();
    private requestLocks: Set<number> = new Set();
    private ws: WebSocket | null = null;
    private lastProcessedHeight: number = 0;
    private isRunning: boolean = false;
    private readonly MAX_CACHE_SIZE = 1000;
    private readonly RECONNECT_INTERVAL = 5000;
    private readonly UPDATE_INTERVAL = 1000;
    private readonly DEFAULT_LAST_N_BLOCKS = 100;
    private readonly MAX_LAST_N_BLOCKS = 200;
    private babylonClient: BabylonClient;
    private updateInterval: NodeJS.Timeout | null = null;
    private epochCache: Map<number, EpochInfo> = new Map();
    private currentEpochInfo: { epochNumber: number; boundary: number } | null = null;
    
    // SSE için yeni özellikler
    private sseClients: Map<string, { res: Response; fpBtcPkHex: string }> = new Map();
    private readonly SSE_RETRY_INTERVAL = 3000;

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

    private async initializeWebSocket(): Promise<void> {
        if (this.ws) {
            console.debug('[WebSocket] Closing existing connection');
            this.ws.close();
            this.ws = null;
        }

        try {
            const currentHeight = await this.babylonClient.getCurrentHeight();
            // Son 100 blok yerine sadece eksik blokları işle
            const lastProcessedBlock = this.lastProcessedHeight || (currentHeight - this.DEFAULT_LAST_N_BLOCKS);
            const startHeight = Math.max(lastProcessedBlock, currentHeight - this.DEFAULT_LAST_N_BLOCKS);
            
            console.debug(`[WebSocket] Initializing with current height: ${currentHeight}, processing from: ${startHeight}`);

            // Eksik blokları bul
            const missingBlocks = [];
            for (let height = startHeight; height < currentHeight; height++) {
                if (!this.signatureCache.has(height)) {
                    missingBlocks.push(height);
                }
            }

            // Sadece eksik blokları işle
            if (missingBlocks.length > 0) {
                console.debug(`[WebSocket] Processing ${missingBlocks.length} missing blocks`);
                await Promise.all(
                    missingBlocks.map(height => this.fetchAndCacheSignatures(height))
                );
            }

            this.ws = new WebSocket(`${process.env.BABYLON_RPC_URL!.replace('http', 'ws')}/websocket`);

            this.ws.on('open', () => {
                console.debug('[WebSocket] Connected successfully');
                this.subscribeToNewBlocks();
            });

            this.ws.on('message', (data: Buffer) => this.onWebSocketMessage(data));

            this.ws.on('close', () => {
                console.warn('[WebSocket] Disconnected, reconnecting...');
                setTimeout(() => this.initializeWebSocket(), this.RECONNECT_INTERVAL);
            });

            this.ws.on('error', (error) => {
                console.error('[WebSocket] Connection error:', error);
                this.ws?.close();
            });

        } catch (error) {
            console.error('[WebSocket] Initialization error:', error);
            setTimeout(() => this.initializeWebSocket(), this.RECONNECT_INTERVAL);
        }
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

    private async fetchAndCacheSignatures(height: number, retryCount = 0): Promise<void> {
        if (this.requestLocks.has(height)) {
            console.debug(`[Cache] Request already in progress for block ${height}, skipping`);
            return;
        }

        this.requestLocks.add(height);
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 1000;

        try {
            console.debug(`[Cache] Fetching signatures for finalized block ${height}`);
            const votes = await this.babylonClient.getVotesAtHeight(height);
            
            if (votes.length === 0 && retryCount < MAX_RETRIES) {
                console.warn(`[Cache] No votes found for block ${height}, retrying in ${RETRY_DELAY}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                this.requestLocks.delete(height);
                return this.fetchAndCacheSignatures(height, retryCount + 1);
            }

            if (votes.length === 0) {
                console.error(`[Cache] No votes found for block ${height} after ${MAX_RETRIES} attempts`);
                this.requestLocks.delete(height);
                return;
            }

            const signers = new Set(votes.map(v => v.fp_btc_pk_hex.toLowerCase()));
            await this.processBlock(height, signers);
            this.lastProcessedHeight = Math.max(this.lastProcessedHeight, height);
            
            console.debug(`[Cache] ✅ Block ${height} processed, signers: ${signers.size}, cache size: ${this.signatureCache.size}`);
        } catch (error) {
            if (retryCount < MAX_RETRIES) {
                console.warn(`[Cache] Error processing block ${height}, retrying in ${RETRY_DELAY}ms (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                this.requestLocks.delete(height);
                return this.fetchAndCacheSignatures(height, retryCount + 1);
            }
            console.error(`[Cache] ❌ Error processing block ${height} after ${MAX_RETRIES} attempts:`, error);
        } finally {
            this.requestLocks.delete(height);
        }
    }

    private async processBlock(height: number, signers: Set<string>): Promise<void> {
        // Eğer cache'de daha fazla imza varsa güncelleme yapma
        const existingSigners = this.signatureCache.get(height);
        if (existingSigners && existingSigners.size > signers.size) {
            return;
        }

        this.signatureCache.set(height, signers);
        
        // Timestamp'i sadece ilk kez kaydederken ayarla
        if (!this.timestampCache.has(height)) {
            this.timestampCache.set(height, new Date());
        }
        
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

    public addSSEClient(clientId: string, res: Response, fpBtcPkHex: string): void {
        // SSE başlık ayarları
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        // Retry interval ayarla
        res.write(`retry: ${this.SSE_RETRY_INTERVAL}\n\n`);

        // Client'ı kaydet
        this.sseClients.set(clientId, { res, fpBtcPkHex });

        // Initial data olarak son 100 bloğu gönder
        this.sendInitialDataToClient(clientId);

        // Client bağlantısı kapandığında temizle
        res.on('close', () => {
            console.log(`[SSE] Client disconnected: ${clientId}`);
            this.sseClients.delete(clientId);
        });
    }

    private async sendInitialDataToClient(clientId: string): Promise<void> {
        const client = this.sseClients.get(clientId);
        if (!client) return;

        try {
            const stats = await this.getSignatureStats({
                fpBtcPkHex: client.fpBtcPkHex,
                lastNBlocks: this.DEFAULT_LAST_N_BLOCKS
            });

            this.sendSSEEvent(clientId, 'initial', stats);
        } catch (error) {
            console.error(`[SSE] Error sending initial data to client ${clientId}:`, error);
        }
    }

    private sendSSEEvent(clientId: string, event: string, data: any): void {
        const client = this.sseClients.get(clientId);
        if (!client) return;

        try {
            client.res.write(`event: ${event}\n`);
            client.res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error(`[SSE] Error sending event to client ${clientId}:`, error);
            this.sseClients.delete(clientId);
        }
    }

    private async broadcastNewBlock(height: number): Promise<void> {
        const signers = this.signatureCache.get(height);
        const timestamp = this.timestampCache.get(height) || new Date();
        
        // Her client için son blok bilgisini gönder
        for (const [clientId, client] of this.sseClients.entries()) {
            try {
                const normalizedPk = client.fpBtcPkHex.toLowerCase();
                const blockInfo: BlockSignatureInfo = {
                    height,
                    signed: signers ? signers.has(normalizedPk) : false,
                    status: !signers ? 'unknown' : (signers.has(normalizedPk) ? 'signed' : 'missed'),
                    timestamp,
                    epochNumber: (await this.getCurrentEpochInfo()).epochNumber
                };

                this.sendSSEEvent(clientId, 'block', blockInfo);
            } catch (error) {
                console.error(`[SSE] Error broadcasting to client ${clientId}:`, error);
            }
        }
    }

    // WebSocket message handler'ını güncelle
    private async handleNewBlock(height: number): Promise<void> {
        try {
            // Önceki bloku işle (finalize olmuş)
            const previousHeight = height - 1;
            await this.fetchAndCacheSignatures(previousHeight);
            
            // SSE client'larına sadece son blok bilgisini gönder
            await this.broadcastNewBlock(previousHeight);
        } catch (error) {
            console.error('[WebSocket] Error processing new block:', error);
        }
    }

    // WebSocket message handler'ını güncelle
    private async onWebSocketMessage(data: Buffer): Promise<void> {
        try {
            const message = JSON.parse(data.toString());
            if (message.result?.data?.value?.block) {
                const height = parseInt(message.result.data.value.block.header.height);
                if (height > this.lastProcessedHeight) {
                    await this.handleNewBlock(height);
                }
            }
        } catch (error) {
            console.error('[WebSocket] Error processing message:', error);
        }
    }
} 