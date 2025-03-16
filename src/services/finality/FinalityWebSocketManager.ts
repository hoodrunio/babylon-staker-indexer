import WebSocket from 'ws';
import { BabylonClient } from '../../clients/BabylonClient';
import { WebsocketHealthTracker } from '../btc-delegations/WebsocketHealthTracker';
import { logger } from '../../utils/logger';

export class FinalityWebSocketManager {
    private static instance: FinalityWebSocketManager | null = null;
    private ws: WebSocket | null = null;
    private isRunning: boolean = false;
    private readonly RECONNECT_INTERVAL = 5000;
    private babylonClient: BabylonClient;
    private healthTracker: WebsocketHealthTracker;
    private onNewBlockCallback: ((height: number) => Promise<void>) | null = null;

    private constructor() {
        this.babylonClient = BabylonClient.getInstance();
        this.healthTracker = WebsocketHealthTracker.getInstance();
    }

    public static getInstance(): FinalityWebSocketManager {
        if (!FinalityWebSocketManager.instance) {
            FinalityWebSocketManager.instance = new FinalityWebSocketManager();
        }
        return FinalityWebSocketManager.instance;
    }

    public setNewBlockCallback(callback: (height: number) => Promise<void>): void {
        this.onNewBlockCallback = callback;
    }

    public async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('[WebSocket] Service is already running');
            return;
        }
        
        logger.info('[WebSocket] Starting WebSocket service...');
        this.isRunning = true;
        await this.initializeWebSocket();
    }

    public stop(): void {
        logger.info('[WebSocket] Stopping WebSocket service...');
        this.isRunning = false;
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    private async initializeWebSocket(): Promise<void> {
        if (this.ws) {
            logger.debug('[WebSocket] Closing existing connection');
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }

        try {
            // Get WebSocket URL from BabylonClient
            const wsUrl = this.babylonClient.getWsEndpoint();
            logger.debug(`[WebSocket] Connecting to ${wsUrl}`);
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                logger.debug(`[WebSocket] Connected successfully to ${this.babylonClient.getNetwork()} network`);
                this.subscribeToNewBlocks();
            });

            this.ws.on('message', async (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.result?.data?.value?.block) {
                        const height = parseInt(message.result.data.value.block.header.height);
                        if (this.onNewBlockCallback && height > 2) {
                            // Process block with 2-block delay for finalization
                            await this.onNewBlockCallback(height - 2);
                            // Update block height in health tracker
                            await this.healthTracker.updateBlockHeight(this.babylonClient.getNetwork(), height - 2);
                        }
                    }
                } catch (error) {
                    logger.error('[WebSocket] Error processing message:', error);
                }
            });

            this.ws.on('close', () => {
                if (!this.isRunning) return;
                logger.warn('[WebSocket] Disconnected, reconnecting...');
                setTimeout(() => this.initializeWebSocket(), this.RECONNECT_INTERVAL);
            });

            this.ws.on('error', (error) => {
                logger.error('[WebSocket] Connection error:', error);
                this.ws?.close();
            });

        } catch (error) {
            logger.error('[WebSocket] Initialization error:', error);
            if (this.isRunning) {
                setTimeout(() => this.initializeWebSocket(), this.RECONNECT_INTERVAL);
            }
        }
    }

    private subscribeToNewBlocks(): void {
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

    public async getCurrentHeight(): Promise<number> {
        return this.babylonClient.getCurrentHeight();
    }
} 