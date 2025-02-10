import WebSocket from 'ws';
import { Network } from '../types/finality';
import { BTCDelegationEventHandler } from './btc-delegations/BTCDelegationEventHandler';
import { WebsocketHealthTracker } from './btc-delegations/WebsocketHealthTracker';
import { BabylonClient } from '../clients/BabylonClient';
import { BLSCheckpointService } from './checkpointing/BLSCheckpointService';

export class WebsocketService {
    private static instance: WebsocketService | null = null;
    private mainnetWs: WebSocket | null = null;
    private testnetWs: WebSocket | null = null;
    private eventHandler: BTCDelegationEventHandler;
    private healthTracker: WebsocketHealthTracker;
    private blsCheckpointService: BLSCheckpointService;
    private babylonClient: Map<Network, BabylonClient> = new Map();
    private reconnectAttempts: Map<Network, number> = new Map();
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private readonly RECONNECT_INTERVAL = 5000; // 5 seconds

    private constructor() {
        this.eventHandler = BTCDelegationEventHandler.getInstance();
        this.healthTracker = WebsocketHealthTracker.getInstance();
        this.blsCheckpointService = BLSCheckpointService.getInstance();
        
        // Mainnet konfigürasyonu varsa ekle
        try {
            if (process.env.BABYLON_NODE_URL && process.env.BABYLON_RPC_URL) {
                this.babylonClient.set(Network.MAINNET, BabylonClient.getInstance(Network.MAINNET));
                console.log('[WebSocket] Mainnet client initialized successfully');
            } else {
                console.log('[WebSocket] Mainnet is not configured, skipping');
            }
        } catch (error) {
            console.warn('[WebSocket] Failed to initialize Mainnet client:', error);
        }

        // Testnet konfigürasyonu varsa ekle
        try {
            if (process.env.BABYLON_TESTNET_NODE_URL && process.env.BABYLON_TESTNET_RPC_URL) {
                this.babylonClient.set(Network.TESTNET, BabylonClient.getInstance(Network.TESTNET));
                console.log('[WebSocket] Testnet client initialized successfully');
            } else {
                console.log('[WebSocket] Testnet is not configured, skipping');
            }
        } catch (error) {
            console.warn('[WebSocket] Failed to initialize Testnet client:', error);
        }

        // En az bir network konfigüre edilmiş olmalı
        if (this.babylonClient.size === 0) {
            throw new Error('[WebSocket] No network configurations found. Please configure at least one network (MAINNET or TESTNET)');
        }
    }

    public static getInstance(): WebsocketService {
        if (!WebsocketService.instance) {
            WebsocketService.instance = new WebsocketService();
        }
        return WebsocketService.instance;
    }

    public startListening() {
        // Sadece konfigüre edilmiş networkler için bağlantı kur
        if (this.babylonClient.has(Network.MAINNET)) {
            this.connectMainnet();
        }
        if (this.babylonClient.has(Network.TESTNET)) {
            this.connectTestnet();
        }
    }

    private connectMainnet() {
        if (this.mainnetWs) return;

        const wsUrl = process.env.BABYLON_WS_URL;
        if (!wsUrl) {
            console.error('BABYLON_WS_URL is not defined');
            return;
        }

        this.setupWebsocket(wsUrl, Network.MAINNET);
    }

    private connectTestnet() {
        if (this.testnetWs) return;

        const wsUrl = process.env.BABYLON_TESTNET_WS_URL;
        if (!wsUrl) {
            console.error('BABYLON_TESTNET_WS_URL is not defined');
            return;
        }

        this.setupWebsocket(wsUrl, Network.TESTNET);
    }

    private setupWebsocket(url: string, network: Network) {
        const ws = new WebSocket(url);
        
        if (network === Network.MAINNET) {
            this.mainnetWs = ws;
        } else {
            this.testnetWs = ws;
        }

        ws.on('open', () => {
            console.log(`Connected to ${network} websocket`);
            this.reconnectAttempts.set(network, 0);
            
            // Subscribe to BTC staking events
            const btcStakingSubscription = {
                jsonrpc: '2.0',
                method: 'subscribe',
                id: 'btc_staking',
                params: {
                    query: "tm.event='Tx' AND message.module='btcstaking'"
                }
            };
            ws.send(JSON.stringify(btcStakingSubscription));

            // Subscribe to checkpointing events
            const checkpointingSubscription = {
                jsonrpc: '2.0',
                method: 'subscribe',
                id: 'checkpoint_for_bls',
                params: {
                    query: "tm.event='NewBlock' AND babylon.checkpointing.v1.EventCheckpointSealed CONTAINS 'checkpoint'"
                }
            };
            ws.send(JSON.stringify(checkpointingSubscription));
        });

        ws.on('message', async (data: Buffer) => {
            try {
                const message = JSON.parse(data.toString());
                
                // Check if this is a subscription confirmation message
                if (message.result && !message.result.data) {
                    console.log(`${network} subscription confirmed:`, message);
                    return;
                }

                const messageValue = message?.result?.data?.value;
                if (!messageValue) {
                    console.log(`${network} received invalid message:`, message);
                    return;
                }

                // Handle NewBlock events (for BLS checkpoints)
                if (messageValue.result_finalize_block) {
                    await this.blsCheckpointService.handleCheckpoint(messageValue, network);
                    return;
                }

                // Handle Tx events (for BTC staking)
                if (messageValue.TxResult?.result?.events) {
                    const height = parseInt(message.result.events['tx.height']?.[0]);
                    const txData = {
                        height,
                        hash: message.result.events['tx.hash']?.[0],
                        events: messageValue.TxResult.result.events
                    };

                    // Validate required fields
                    if (!txData.height || !txData.hash || !txData.events) {
                        console.log(`${network} transaction missing required fields:`, txData);
                        return;
                    }

                    // Update health tracker with current height
                    await this.healthTracker.updateBlockHeight(network, height);
                    
                    // Handle BTC delegation events
                    await this.eventHandler.handleEvent(txData, network);
                    return;
                }

                console.log(`${network} received unhandled message type:`, message);
            } catch (error) {
                console.error(`Error handling ${network} websocket message:`, error);
            }
        });

        ws.on('close', async () => {
            console.log(`${network} websocket connection closed`);
            this.healthTracker.markDisconnected(network);
            await this.handleReconnect(network);
        });

        ws.on('error', (error) => {
            console.error(`${network} websocket error:`, error);
            ws.close();
        });
    }

    private async handleReconnect(network: Network) {
        const attempts = this.reconnectAttempts.get(network) || 0;
        
        if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts.set(network, attempts + 1);
            console.log(`[${network}] Attempting to reconnect (attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
            
            try {
                // Sadece konfigüre edilmiş client'lar için işlem yap
                const client = this.babylonClient.get(network);
                if (client) {
                    await this.healthTracker.handleReconnection(network, client);
                }

                setTimeout(() => {
                    if (network === Network.MAINNET && this.babylonClient.has(Network.MAINNET)) {
                        this.mainnetWs = null;
                        this.connectMainnet();
                    } else if (network === Network.TESTNET && this.babylonClient.has(Network.TESTNET)) {
                        this.testnetWs = null;
                        this.connectTestnet();
                    }
                }, this.RECONNECT_INTERVAL);
            } catch (error) {
                console.error(`[${network}] Error handling reconnection:`, error);
                // Hata durumunda da reconnect dene
                this.handleReconnect(network);
            }
        } else {
            console.error(`[${network}] Max reconnection attempts reached`);
        }
    }

    public stop() {
        if (this.mainnetWs) {
            this.mainnetWs.close();
            this.mainnetWs = null;
        }
        if (this.testnetWs) {
            this.testnetWs.close();
            this.testnetWs = null;
        }
    }
} 