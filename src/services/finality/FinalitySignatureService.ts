import WebSocket from 'ws';
import { BabylonClient } from '../../clients/BabylonClient';
import { 
    BlockSignatureInfo, 
    SignatureStats, 
    EpochInfo, 
    SignatureStatsParams,
    EpochStats
} from '../../types';
import { Response } from 'express';
import { Network } from '../../api/middleware/network-selector';

export class FinalitySignatureService {
    private static instance: FinalitySignatureService | null = null;
    private signatureCache: Map<number, Set<string>> = new Map();
    private timestampCache: Map<number, Date> = new Map();
    private requestLocks: Map<string, boolean> = new Map();
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
    private sseClients: Map<string, { res: Response; fpBtcPkHex: string; initialDataSent?: boolean }> = new Map();
    private readonly SSE_RETRY_INTERVAL = 3000;
    private readonly FINALIZATION_DELAY = 3000; // 3 saniye bekle
    private readonly MAX_RETRY_DELAY = 5000; // Maximum delay between retries in ms
    private processedBlocks: Set<number> = new Set();
    private currentBlockHeight: number = 0;

    private constructor() {
        if (!process.env.BABYLON_NODE_URL || !process.env.BABYLON_RPC_URL) {
            throw new Error('BABYLON_NODE_URL and BABYLON_RPC_URL environment variables must be set');
        }
        this.babylonClient = BabylonClient.getInstance(
            process.env.BABYLON_NODE_URL,
            process.env.BABYLON_RPC_URL
        );
    }

    private getNetworkConfig(network: Network = Network.MAINNET) {
        return {
            nodeUrl: network === Network.MAINNET ? process.env.BABYLON_NODE_URL : process.env.BABYLON_TESTNET_NODE_URL,
            rpcUrl: network === Network.MAINNET ? process.env.BABYLON_RPC_URL : process.env.BABYLON_TESTNET_RPC_URL
        };
    }
    
    public static getInstance(): FinalitySignatureService {
        if (!FinalitySignatureService.instance) {
            FinalitySignatureService.instance = new FinalitySignatureService();
        }
        return FinalitySignatureService.instance;
    }

    public async start(): Promise<void> {
        if (this.isRunning) {
            console.warn('[FinalityService] Service is already running');
            return;
        }
        
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
                this.currentBlockHeight = currentHeight;
                
                // Son işlenen bloktan sonraki ilk bloğu işle
                const nextHeight = this.lastProcessedHeight + 1;
                
                // Eğer işlenecek yeni blok varsa ve finalize olmuşsa işle
                if (nextHeight < currentHeight) {
                    await this.fetchAndCacheSignatures(nextHeight);
                }
            } catch (error) {
                console.error('[FinalityService] Error in periodic update:', error);
            }
        }, this.UPDATE_INTERVAL);
    }

    private async initializeWebSocket(): Promise<void> {
        if (this.ws) {
            console.debug('[WebSocket] Closing existing connection');
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }

        try {
            const currentHeight = await this.babylonClient.getCurrentHeight();
            this.currentBlockHeight = currentHeight;
            
            // Son N blok içinde kalacak şekilde başlangıç yüksekliğini hesapla
            const startHeight = currentHeight - this.DEFAULT_LAST_N_BLOCKS;
            this.lastProcessedHeight = startHeight - 1; // Başlangıç yüksekliğinden önceki blokları işleme
            
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

            const wsUrl = `${process.env.BABYLON_RPC_URL!.replace('http', 'ws')}/websocket`;
            console.debug(`[WebSocket] Connecting to ${wsUrl}`);
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                console.debug('[WebSocket] Connected successfully');
                this.subscribeToNewBlocks();
            });

            this.ws.on('message', async (data: Buffer) => {
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
            });

            this.ws.on('close', () => {
                if (!this.isRunning) return;
                console.warn('[WebSocket] Disconnected, reconnecting...');
                setTimeout(() => this.initializeWebSocket(), this.RECONNECT_INTERVAL);
            });

            this.ws.on('error', (error) => {
                console.error('[WebSocket] Connection error:', error);
                this.ws?.close();
            });

        } catch (error) {
            console.error('[WebSocket] Initialization error:', error);
            if (this.isRunning) {
                setTimeout(() => this.initializeWebSocket(), this.RECONNECT_INTERVAL);
            }
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

    private async updateCurrentBlockHeight(): Promise<void> {
        try {
            this.currentBlockHeight = await this.babylonClient.getCurrentHeight();
        } catch (error) {
            console.error('[Cache] Error updating current block height:', error);
        }
    }

    private async fetchAndCacheSignatures(height: number, retryCount = 0): Promise<void> {
        const requestKey = `${height}-${retryCount}`;
        
        // Blok zaten işlenmişse veya cache'de varsa atla
        if (this.processedBlocks.has(height) || this.signatureCache.has(height)) {
            return;
        }

        // İstek zaten devam ediyorsa atla
        if (this.requestLocks.has(requestKey)) {
            return;
        }

        this.requestLocks.set(requestKey, true);
        const MAX_RETRIES = 2;
        const retryDelay = Math.min(this.MAX_RETRY_DELAY, (retryCount + 1) * 2000);

        try {
            const votes = await this.babylonClient.getVotesAtHeight(height);
            
            if (votes.length === 0 && retryCount < MAX_RETRIES) {
                this.requestLocks.delete(requestKey);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                return this.fetchAndCacheSignatures(height, retryCount + 1);
            }

            if (votes.length > 0) {
                const signers = new Set(votes.map(v => v.fp_btc_pk_hex.toLowerCase()));
                await this.processBlock(height, signers);
                this.processedBlocks.add(height);
                console.debug(`[Cache] ✅ Block ${height} processed, signers: ${signers.size}, cache size: ${this.signatureCache.size}`);
            } else {
                console.debug(`[Cache] No votes found for block ${height} after ${MAX_RETRIES} attempts`);
            }
        } catch (error) {
            if (retryCount < MAX_RETRIES) {
                this.requestLocks.delete(requestKey);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                return this.fetchAndCacheSignatures(height, retryCount + 1);
            }
            console.error(`[Cache] ❌ Error processing block ${height} after ${MAX_RETRIES} attempts:`, error);
        } finally {
            this.requestLocks.delete(requestKey);
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
        const { nodeUrl, rpcUrl } = this.getNetworkConfig(params.network);
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
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
            'X-Accel-Buffering': 'no' // Nginx buffering'i devre dışı bırak
        });

        // Retry interval ayarla
        res.write(`retry: ${this.SSE_RETRY_INTERVAL}\n\n`);

        // Client'ı kaydet
        this.sseClients.set(clientId, { res, fpBtcPkHex, initialDataSent: false });

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
        if (!client || client.initialDataSent) return;

        try {
            const stats = await this.getSignatureStats({
                fpBtcPkHex: client.fpBtcPkHex,
                lastNBlocks: this.DEFAULT_LAST_N_BLOCKS
            });

            this.sendSSEEvent(clientId, 'initial', stats);
            client.initialDataSent = true;
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
        
        // Epoch bilgisini al
        const epochInfo = await this.getCurrentEpochInfo();
        const blocksPerEpoch = 360;
        const currentEpochStart = epochInfo.boundary - blocksPerEpoch + 1;
        
        // Epoch hesaplama mantığını calculateStats ile aynı şekilde yap
        const heightEpoch = epochInfo.epochNumber + Math.floor((height - currentEpochStart) / blocksPerEpoch);
        
        // Her client için son blok bilgisini gönder
        const sentClients = new Set<string>();
        
        for (const [clientId, client] of this.sseClients.entries()) {
            if (sentClients.has(clientId)) continue;
            
            try {
                const normalizedPk = client.fpBtcPkHex.toLowerCase();
                const blockInfo: BlockSignatureInfo = {
                    height,
                    signed: signers ? signers.has(normalizedPk) : false,
                    status: !signers ? 'unknown' : (signers.has(normalizedPk) ? 'signed' : 'missed'),
                    timestamp,
                    epochNumber: heightEpoch
                };

                this.sendSSEEvent(clientId, 'block', blockInfo);
                sentClients.add(clientId);
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
            
            // Eğer blok zaten işlenmişse veya son işlenen bloktan küçükse atla
            if (previousHeight <= this.lastProcessedHeight || this.processedBlocks.has(previousHeight)) {
                return;
            }

            // Blokun finalize olması için bekle
            await new Promise(resolve => setTimeout(resolve, this.FINALIZATION_DELAY));
            
            await this.fetchAndCacheSignatures(previousHeight);
            this.lastProcessedHeight = previousHeight;
            
            // SSE client'larına sadece son blok bilgisini gönder
            await this.broadcastNewBlock(previousHeight);

            // Cache'i temizle
            this.cleanupCache();
        } catch (error) {
            console.error('[WebSocket] Error processing new block:', error);
        }
    }

    // Cache temizleme metodunu ekle
    private cleanupCache(): void {
        if (this.processedBlocks.size > this.MAX_CACHE_SIZE) {
            const oldestBlocks = Array.from(this.processedBlocks).sort((a, b) => a - b).slice(0, 100);
            oldestBlocks.forEach(height => {
                this.processedBlocks.delete(height);
                this.signatureCache.delete(height);
                this.timestampCache.delete(height);
            });
            console.debug(`[Cache] Cleaned up ${oldestBlocks.length} old blocks from cache`);
        }
    }
} 