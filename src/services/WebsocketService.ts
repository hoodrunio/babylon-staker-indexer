import WebSocket from 'ws';
import { Network } from '../types/finality';
import { BTCDelegationEventHandler } from './btc-delegations/BTCDelegationEventHandler';

export class WebsocketService {
    private static instance: WebsocketService | null = null;
    private mainnetWs: WebSocket | null = null;
    private testnetWs: WebSocket | null = null;
    private eventHandler: BTCDelegationEventHandler;
    private reconnectAttempts: Map<Network, number> = new Map();
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private readonly RECONNECT_INTERVAL = 5000; // 5 seconds

    private constructor() {
        this.eventHandler = BTCDelegationEventHandler.getInstance();
    }

    public static getInstance(): WebsocketService {
        if (!WebsocketService.instance) {
            WebsocketService.instance = new WebsocketService();
        }
        return WebsocketService.instance;
    }

    public startListening() {
        this.connectMainnet();
        this.connectTestnet();
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
            
            // Subscribe to all BTC staking module events
            const subscribeMsg = {
                jsonrpc: '2.0',
                method: 'subscribe',
                id: '0',
                params: {
                    query: "tm.event='Tx' AND message.module='btcstaking'"
                }
            };
            ws.send(JSON.stringify(subscribeMsg));
        });

        ws.on('message', async (data: WebSocket.Data) => {
            try {
                const message = JSON.parse(data.toString());
                
                // Check if this is a subscription confirmation message
                if (message.result && !message.result.data) {
                    console.log(`${network} subscription confirmed:`, message);
                    return;
                }

                // Validate message structure
                if (!message?.result?.data?.value?.TxResult) {
                    console.log(`${network} received non-transaction message:`, message);
                    return;
                }

                const txResult = message.result.data.value.TxResult;
                if (!txResult?.result?.events) {
                    console.log(`${network} transaction missing events:`, txResult);
                    return;
                }

                const txData = {
                    height: message.result.events['tx.height']?.[0],
                    hash: message.result.events['tx.hash']?.[0],
                    events: txResult.result.events
                };

                // Validate required fields
                if (!txData.height || !txData.hash || !txData.events) {
                    console.log(`${network} transaction missing required fields:`, txData);
                    return;
                }                
                // Event'i handler'a ilet
                await this.eventHandler.handleEvent(txData, network);
            } catch (error) {
                console.error(`Error handling ${network} websocket message:`, error);
            }
        });

        ws.on('close', () => {
            console.log(`${network} websocket connection closed`);
            this.handleReconnect(network);
        });

        ws.on('error', (error) => {
            console.error(`${network} websocket error:`, error);
            ws.close();
        });
    }

    private handleReconnect(network: Network) {
        const attempts = this.reconnectAttempts.get(network) || 0;
        
        if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts.set(network, attempts + 1);
            console.log(`Attempting to reconnect to ${network} websocket (attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
            
            setTimeout(() => {
                if (network === Network.MAINNET) {
                    this.mainnetWs = null;
                    this.connectMainnet();
                } else {
                    this.testnetWs = null;
                    this.connectTestnet();
                }
            }, this.RECONNECT_INTERVAL);
        } else {
            console.error(`Max reconnection attempts reached for ${network} websocket`);
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