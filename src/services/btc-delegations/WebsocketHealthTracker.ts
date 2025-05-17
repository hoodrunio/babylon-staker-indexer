import { Network } from '../../types/finality';
import { MissedBlocksProcessor } from './MissedBlocksProcessor';
import { BabylonClient } from '../../clients/BabylonClient';
import { Mutex } from 'async-mutex';
import { CacheService } from '../CacheService';
import { logger } from '../../utils/logger';
import dotenv from 'dotenv';

dotenv.config();
export class WebsocketHealthTracker {
    private static instance: WebsocketHealthTracker | null = null;
    private state: Map<Network, WebsocketState> = new Map();
    private missedBlocksProcessor: MissedBlocksProcessor;
    private mutex: Map<Network, Mutex> = new Map();
    private cacheService: CacheService;
    private babylonClient: BabylonClient;
    private network: Network;
    private readonly CACHE_KEY_PREFIX = 'last_processed_height:';
    private readonly CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
    private readonly isProduction = process.env.NODE_ENV === 'production';
    
    private constructor() {
        this.missedBlocksProcessor = MissedBlocksProcessor.getInstance();
        this.cacheService = CacheService.getInstance();
        
        try {
            // Initialize BabylonClient using the network from environment variable
            this.babylonClient = BabylonClient.getInstance();
            this.network = this.babylonClient.getNetwork();
            
            // Create a mutex for the configured network
            this.mutex.set(this.network, new Mutex());
            
            // Initialize state for the configured network
            const initialState = {
                lastProcessedHeight: 0,
                isConnected: true,
                lastConnectionTime: new Date(),
                lastUpdateTime: new Date()
            };
            this.state.set(this.network, initialState);
            logger.info(`[WebsocketHealthTracker] Initialized state for network: ${this.network}`);
            
            // Get last block height from cache
            this.loadLastProcessedHeight(this.network);
        } catch (error) {
            logger.error('Failed to initialize BabylonClient:', error);
            throw new Error('Failed to initialize BabylonClient. Please check your NETWORK environment variable.');
        }
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

        // Lock with mutex
        const release = await mutex.acquire();
        try {
            const currentState = this.getOrCreateState(network);
            
            // Only process real gaps (if more than 1 block is skipped)
            if (height > currentState.lastProcessedHeight + 1 && this.isProduction) {
                logger.debug(`[${network}] Gap detected: ${currentState.lastProcessedHeight} -> ${height}`);
                
                // Process missing blocks using the app's single client instance
                await this.missedBlocksProcessor.processMissedBlocks(
                    network,
                    currentState.lastProcessedHeight + 1,
                    height - 1 // Except last block
                );
            }

            // Update new height
            if (height > currentState.lastProcessedHeight) {
                logger.debug(`[${network}] Updating block height from ${currentState.lastProcessedHeight} to ${height}`);
                currentState.lastProcessedHeight = height;
                currentState.lastUpdateTime = new Date();
                this.state.set(network, currentState);

                // Save to cache
                await this.cacheService.set(
                    `${this.CACHE_KEY_PREFIX}${network}`,
                    height,
                    this.CACHE_TTL
                );
            }
        } finally {
            // Always release mutex
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

    public async handleReconnection(network: Network) {
        const mutex = this.mutex.get(network);
        if (!mutex) {
            logger.error(`[${network}] No mutex found for network`);
            return;
        }

        // Lock with mutex
        const release = await mutex.acquire();
        try {
            const state = this.getOrCreateState(network);
            const currentHeight = await this.babylonClient.getCurrentHeight();
            const lastProcessedHeight = state.lastProcessedHeight;

            // Process if there are missing blocks
            if (currentHeight > lastProcessedHeight && this.isProduction) {
                logger.debug(`[${network}] Gap detected during reconnection: ${lastProcessedHeight} -> ${currentHeight}`);
                
                await this.missedBlocksProcessor.processMissedBlocks(
                    network,
                    lastProcessedHeight + 1,
                    currentHeight
                );

                state.lastProcessedHeight = currentHeight;
                this.state.set(network, state);

                // Save to cache
                await this.cacheService.set(
                    `${this.CACHE_KEY_PREFIX}${network}`,
                    currentHeight,
                    this.CACHE_TTL
                );
            }

            // Update connection status
            state.isConnected = true;
            state.disconnectedAt = undefined;
            this.state.set(network, state);

        } catch (error) {
            logger.error(`[${network}] Error processing missed blocks:`, error);
            throw error;
        } finally {
            // Always release mutex
            release();
        }
    }

    /**
     * Get the current state for a network
     * With simplified network approach, we check if the requested network
     * matches our initialized network
     */
    public getNetworkState(network: Network): WebsocketState | undefined {
        // In the simplified network approach, we only track the network from environment
        // First ensure we have a state for our configured network
        if (!this.state.has(this.network)) {
            logger.debug(`[WebsocketHealthTracker] No state found for our configured network: ${this.network}, initializing state`);
            this.getOrCreateState(this.network);
        }
        
        // If the requested network doesn't match our configured network, return undefined
        if (network !== this.network) {
            logger.debug(`[WebsocketHealthTracker] Requested state for ${network} but we're running with ${this.network}`);
            return undefined;
        }
        
        return this.state.get(this.network);
    }

    private getOrCreateState(network: Network): WebsocketState {
        let state = this.state.get(network);
        if (!state) {
            logger.info(`[WebsocketHealthTracker] Creating new state for network: ${network}`);
            state = {
                lastProcessedHeight: 0,
                isConnected: true,
                lastConnectionTime: new Date(),
                lastUpdateTime: new Date()
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
    lastUpdateTime?: Date;
    disconnectedAt?: Date;
}