import { Network } from '../../types/finality';
import { MissedBlocksProcessor } from './MissedBlocksProcessor';
import { BabylonClient } from '../../clients/BabylonClient';
import { Mutex } from 'async-mutex';
import { CacheService } from '../CacheService';
import { logger } from '../../utils/logger';

export class WebsocketHealthTracker {
    private static instance: WebsocketHealthTracker | null = null;
    private state: Map<Network, WebsocketState> = new Map();
    private missedBlocksProcessor: MissedBlocksProcessor;
    private mutex: Map<Network, Mutex> = new Map();
    private cacheService: CacheService;
    private readonly CACHE_KEY_PREFIX = 'last_processed_height:';
    private readonly CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
    
    private constructor() {
        this.missedBlocksProcessor = MissedBlocksProcessor.getInstance();
        this.cacheService = CacheService.getInstance();
        
        // Her network için bir mutex oluştur
        Object.values(Network).forEach(network => {
            this.mutex.set(network, new Mutex());
            // Cache'den son blok yüksekliğini al
            this.loadLastProcessedHeight(network);
        });
    }

    private async loadLastProcessedHeight(network: Network) {
        try {
            const height = await this.cacheService.get<number>(`${this.CACHE_KEY_PREFIX}${network}`);
            if (height !== null) {
                const state = this.getOrCreateState(network);
                state.lastProcessedHeight = height;
                this.state.set(network, state);
                logger.debug(`[${network}] Loaded last processed height from cache: ${height}`);
            }
        } catch (error) {
            logger.error(`[${network}] Error loading last processed height from cache:`, error);
        }
    }

    public static getInstance(): WebsocketHealthTracker {
        if (!WebsocketHealthTracker.instance) {
            WebsocketHealthTracker.instance = new WebsocketHealthTracker();
        }
        return WebsocketHealthTracker.instance;
    }

    public async updateBlockHeight(network: Network, height: number) {
        const mutex = this.mutex.get(network);
        if (!mutex) {
            logger.error(`[${network}] No mutex found for network`);
            return;
        }

        // Mutex ile kilitle
        const release = await mutex.acquire();
        try {
            const currentState = this.getOrCreateState(network);
            
            // Sadece gerçek gap'leri işle (1'den fazla blok atlanmışsa)
            if (height > currentState.lastProcessedHeight + 1) {
                logger.debug(`[${network}] Gap detected: ${currentState.lastProcessedHeight} -> ${height}`);
                
                // Eksik blokları işle
                const client = BabylonClient.getInstance(network);
                await this.missedBlocksProcessor.processMissedBlocks(
                    network,
                    currentState.lastProcessedHeight + 1,
                    height - 1, // Son blok hariç
                    client
                );
            }

            // Yeni yüksekliği güncelle
            if (height > currentState.lastProcessedHeight) {
                logger.debug(`[${network}] Updating block height from ${currentState.lastProcessedHeight} to ${height}`);
                currentState.lastProcessedHeight = height;
                this.state.set(network, currentState);

                // Cache'e kaydet
                await this.cacheService.set(
                    `${this.CACHE_KEY_PREFIX}${network}`,
                    height,
                    this.CACHE_TTL
                );
            }
        } finally {
            // Her durumda mutex'i serbest bırak
            release();
        }
    }

    public markDisconnected(network: Network) {
        const currentState = this.getOrCreateState(network);
        currentState.isConnected = false;
        currentState.disconnectedAt = new Date();
        this.state.set(network, currentState);
        
        logger.info(`[${network}] Websocket disconnected at height ${currentState.lastProcessedHeight}`);
    }

    public async handleReconnection(network: Network, babylonClient: BabylonClient) {
        const mutex = this.mutex.get(network);
        if (!mutex) {
            logger.error(`[${network}] No mutex found for network`);
            return;
        }

        // Mutex ile kilitle
        const release = await mutex.acquire();
        try {
            const state = this.getOrCreateState(network);
            const currentHeight = await babylonClient.getCurrentHeight();
            const lastProcessedHeight = state.lastProcessedHeight;

            // Eksik blok varsa işle
            if (currentHeight > lastProcessedHeight) {
                logger.debug(`[${network}] Gap detected during reconnection: ${lastProcessedHeight} -> ${currentHeight}`);
                
                await this.missedBlocksProcessor.processMissedBlocks(
                    network,
                    lastProcessedHeight + 1,
                    currentHeight,
                    babylonClient
                );

                state.lastProcessedHeight = currentHeight;
                this.state.set(network, state);

                // Cache'e kaydet
                await this.cacheService.set(
                    `${this.CACHE_KEY_PREFIX}${network}`,
                    currentHeight,
                    this.CACHE_TTL
                );
            }

            // Bağlantı durumunu güncelle
            state.isConnected = true;
            state.disconnectedAt = undefined;
            this.state.set(network, state);

        } catch (error) {
            logger.error(`[${network}] Error processing missed blocks:`, error);
            throw error;
        } finally {
            // Her durumda mutex'i serbest bırak
            release();
        }
    }

    private getOrCreateState(network: Network): WebsocketState {
        let state = this.state.get(network);
        if (!state) {
            state = {
                lastProcessedHeight: 0,
                isConnected: true,
                lastConnectionTime: new Date()
            };
            this.state.set(network, state);
        }
        return state;
    }
}

interface WebsocketState {
    lastProcessedHeight: number;
    isConnected: boolean;
    lastConnectionTime: Date;
    disconnectedAt?: Date;
}