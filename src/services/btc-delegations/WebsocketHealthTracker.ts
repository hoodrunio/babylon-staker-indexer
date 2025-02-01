import { Network } from '../../types/finality';
import { MissedBlocksProcessor } from './MissedBlocksProcessor';
import { BabylonClient } from '../../clients/BabylonClient';

export class WebsocketHealthTracker {
    private static instance: WebsocketHealthTracker | null = null;
    private state: Map<Network, WebsocketState> = new Map();
    private missedBlocksProcessor: MissedBlocksProcessor;
    
    private constructor() {
        this.missedBlocksProcessor = MissedBlocksProcessor.getInstance();
    }

    public static getInstance(): WebsocketHealthTracker {
        if (!WebsocketHealthTracker.instance) {
            WebsocketHealthTracker.instance = new WebsocketHealthTracker();
        }
        return WebsocketHealthTracker.instance;
    }

    public updateBlockHeight(network: Network, height: number) {
        const currentState = this.getOrCreateState(network);
        currentState.lastProcessedHeight = height;
        this.state.set(network, currentState);
    }

    public markDisconnected(network: Network) {
        const currentState = this.getOrCreateState(network);
        currentState.isConnected = false;
        currentState.disconnectedAt = new Date();
        this.state.set(network, currentState);
        
        console.log(`[${network}] Websocket disconnected at height ${currentState.lastProcessedHeight}`);
    }

    public async handleReconnection(network: Network, babylonClient: BabylonClient) {
        const state = this.getOrCreateState(network);
        if (!state.disconnectedAt) return;

        try {
            const currentHeight = await babylonClient.getCurrentHeight();
            const lastProcessedHeight = state.lastProcessedHeight;

            if (currentHeight <= lastProcessedHeight) return;

            console.log(`[${network}] Processing missed blocks:`, {
                lastProcessed: lastProcessedHeight,
                current: currentHeight,
                difference: currentHeight - lastProcessedHeight
            });

            await this.missedBlocksProcessor.processMissedBlocks(
                network,
                lastProcessedHeight + 1,
                currentHeight,
                babylonClient
            );

            // State'i güncelle
            state.isConnected = true;
            state.lastProcessedHeight = currentHeight;
            state.disconnectedAt = undefined;
            this.state.set(network, state);

        } catch (error) {
            console.error(`[${network}] Error processing missed blocks:`, error);
            throw error;
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