import { MissedBlocksProcessor } from './MissedBlocksProcessor';
import { BabylonClient } from '../../clients/BabylonClient';
import { Mutex } from 'async-mutex';
import { CacheService } from '../CacheService';
import { logger } from '../../utils/logger';
import dotenv from 'dotenv';

dotenv.config();
export class WebsocketHealthTracker {
    private static instance: WebsocketHealthTracker | null = null;
    private state: WebsocketState;
    private missedBlocksProcessor: MissedBlocksProcessor;
    private mutex: Mutex;
    private cacheService: CacheService;
    private babylonClient: BabylonClient;
    private readonly CACHE_KEY_PREFIX = 'last_processed_height';
    private readonly CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
    private readonly isProduction = process.env.NODE_ENV === 'production';
    
    private constructor() {
        this.missedBlocksProcessor = MissedBlocksProcessor.getInstance();
        this.cacheService = CacheService.getInstance();
        this.babylonClient = BabylonClient.getInstance();
        this.mutex = new Mutex();
        this.state = {
            lastProcessedHeight: 0,
            isConnected: true,
            lastConnectionTime: new Date(),
            lastUpdateTime: new Date()
        };
        
        // Load the last processed height from cache
        this.loadLastProcessedHeight();
    }

    private async loadLastProcessedHeight() {
        try {
            const height = await this.cacheService.get<number>(this.CACHE_KEY_PREFIX);
            if (height !== null) {
                this.state.lastProcessedHeight = height;
                logger.debug(`Loaded last processed height from cache: ${height}`);
            }
        } catch (error) {
            logger.error(`Error loading last processed height from cache:`, error);
        }
    }

    public static getInstance(): WebsocketHealthTracker {
        if (!WebsocketHealthTracker.instance) {
            WebsocketHealthTracker.instance = new WebsocketHealthTracker();
        }
        return WebsocketHealthTracker.instance;
    }

    public async updateBlockHeight(height: number) {
        // Lock with mutex
        const release = await this.mutex.acquire();
        try {
            // Only process real gaps (if more than 1 block is skipped)
            if (height > this.state.lastProcessedHeight + 1 && this.isProduction) {
                logger.debug(`Gap detected: ${this.state.lastProcessedHeight} -> ${height}`);
                
                // Process missing blocks
                await this.missedBlocksProcessor.processMissedBlocks(
                    this.state.lastProcessedHeight + 1,
                    height - 1, // Except last block
                    this.babylonClient
                );
            }

            // Update new height
            if (height > this.state.lastProcessedHeight) {
                logger.debug(`Updating block height from ${this.state.lastProcessedHeight} to ${height}`);
                this.state.lastProcessedHeight = height;
                this.state.lastUpdateTime = new Date();

                // Save to cache
                await this.cacheService.set(
                    this.CACHE_KEY_PREFIX,
                    height,
                    this.CACHE_TTL
                );
            }
        } finally {
            // Always release mutex
            release();
        }
    }

    public markDisconnected() {
        this.state.isConnected = false;
        this.state.disconnectedAt = new Date();
        
        logger.info(`Websocket disconnected at height ${this.state.lastProcessedHeight}`);
    }

    public async handleReconnection(client: BabylonClient = this.babylonClient) {
        // Lock with mutex
        const release = await this.mutex.acquire();
        try {
            const currentHeight = await client.getCurrentHeight();
            const lastProcessedHeight = this.state.lastProcessedHeight;

            // Process if there are missing blocks
            if (currentHeight > lastProcessedHeight && this.isProduction) {
                logger.debug(`Gap detected during reconnection: ${lastProcessedHeight} -> ${currentHeight}`);
                
                await this.missedBlocksProcessor.processMissedBlocks(
                    lastProcessedHeight + 1,
                    currentHeight,
                    client
                );

                this.state.lastProcessedHeight = currentHeight;

                // Save to cache
                await this.cacheService.set(
                    this.CACHE_KEY_PREFIX,
                    currentHeight,
                    this.CACHE_TTL
                );
            }

            // Update connection status
            this.state.isConnected = true;
            this.state.disconnectedAt = undefined;

        } catch (error) {
            logger.error(`Error processing missed blocks:`, error);
            throw error;
        } finally {
            // Always release mutex
            release();
        }
    }

    /**
     * Get the current state
     */
    public getState(): WebsocketState {
        return this.state;
    }
}

interface WebsocketState {
    lastProcessedHeight: number;
    isConnected: boolean;
    lastConnectionTime: Date;
    lastUpdateTime?: Date;
    disconnectedAt?: Date;
}