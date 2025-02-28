import WebSocket from 'ws';
import { Network } from '../types/finality';
import { BTCDelegationEventHandler } from './btc-delegations/BTCDelegationEventHandler';
import { WebsocketHealthTracker } from './btc-delegations/WebsocketHealthTracker';
import { BabylonClient } from '../clients/BabylonClient';
import { BLSCheckpointService } from './checkpointing/BLSCheckpointService';
import { CheckpointStatusHandler } from './checkpointing/CheckpointStatusHandler';
import { ValidatorSignatureService } from './validator/ValidatorSignatureService';
import { ValidatorHistoricalSyncService } from './validator/ValidatorHistoricalSyncService';
import { CovenantEventHandler } from './covenant/CovenantEventHandler';
import { GovernanceEventHandler } from './governance/GovernanceEventHandler';
import { logger } from '../utils/logger';

export class WebsocketService {
    private static instance: WebsocketService | null = null;
    private mainnetWs: WebSocket | null = null;
    private testnetWs: WebSocket | null = null;
    private mainnetConnections: Map<string, WebSocket> = new Map();
    private testnetConnections: Map<string, WebSocket> = new Map();
    private connectionSubscriptionCount: Map<WebSocket, number> = new Map();
    private readonly MAX_SUBSCRIPTIONS_PER_CONNECTION = 5;
    private eventHandler: BTCDelegationEventHandler;
    private covenantEventHandler: CovenantEventHandler;
    private governanceEventHandler: GovernanceEventHandler;
    private healthTracker: WebsocketHealthTracker;
    private blsCheckpointService: BLSCheckpointService;
    private validatorSignatureService: ValidatorSignatureService;
    private validatorHistoricalSync: ValidatorHistoricalSyncService;
    private babylonClient: Map<Network, BabylonClient> = new Map();
    private reconnectAttempts: Map<Network, number> = new Map();
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private readonly RECONNECT_INTERVAL = 5000; // 5 seconds
    private checkpointStatusHandler: CheckpointStatusHandler;
    private subscriptions?: Map<string, { network: Network; connection: WebSocket; callback: (data: any) => void }>;

    private constructor() {
        this.eventHandler = BTCDelegationEventHandler.getInstance();
        this.covenantEventHandler = CovenantEventHandler.getInstance();
        this.governanceEventHandler = GovernanceEventHandler.getInstance();
        this.healthTracker = WebsocketHealthTracker.getInstance();
        this.blsCheckpointService = BLSCheckpointService.getInstance();
        this.checkpointStatusHandler = CheckpointStatusHandler.getInstance();
        this.validatorSignatureService = ValidatorSignatureService.getInstance();
        this.validatorHistoricalSync = ValidatorHistoricalSyncService.getInstance();
        
        // Add mainnet configuration if exists
        try {
            if (process.env.BABYLON_NODE_URL && process.env.BABYLON_RPC_URL) {
                this.babylonClient.set(Network.MAINNET, BabylonClient.getInstance(Network.MAINNET));
                logger.info('[WebSocket] Mainnet client initialized successfully');
            } else {
                logger.info('[WebSocket] Mainnet is not configured, skipping');
            }
        } catch (error) {
            logger.warn('[WebSocket] Failed to initialize Mainnet client:', error);
        }

        // Add testnet configuration if exists
        try {
            if (process.env.BABYLON_TESTNET_NODE_URL && process.env.BABYLON_TESTNET_RPC_URL) {
                this.babylonClient.set(Network.TESTNET, BabylonClient.getInstance(Network.TESTNET));
                logger.info('[WebSocket] Testnet client initialized successfully');
            } else {
                logger.info('[WebSocket] Testnet is not configured, skipping');
            }
        } catch (error) {
            logger.warn('[WebSocket] Failed to initialize Testnet client:', error);
        }

        // At least one network must be configured
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
        // Establish connection only for configured networks
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
            logger.error('BABYLON_WS_URL is not defined');
            return;
        }

        this.setupWebsocket(wsUrl, Network.MAINNET);
    }

    private connectTestnet() {
        if (this.testnetWs) return;

        const wsUrl = process.env.BABYLON_TESTNET_WS_URL;
        if (!wsUrl) {
            logger.error('BABYLON_TESTNET_WS_URL is not defined');
            return;
        }

        this.setupWebsocket(wsUrl, Network.TESTNET);
    }

    private setupWebsocket(url: string, network: Network, connectionId: string = 'default') {
        logger.info(`Setting up new websocket connection for ${network} with ID ${connectionId}`);
        
        const ws = new WebSocket(url);
        
        // Store the connection in the appropriate map
        if (network === Network.MAINNET) {
            if (connectionId === 'default') {
                this.mainnetWs = ws;
            }
            this.mainnetConnections.set(connectionId, ws);
        } else {
            if (connectionId === 'default') {
                this.testnetWs = ws;
            }
            this.testnetConnections.set(connectionId, ws);
        }

        // Initialize subscription count
        this.connectionSubscriptionCount.set(ws, 0);

        ws.on('open', async () => {
            logger.info(`Connected to ${network} websocket`);
            this.reconnectAttempts.set(network, 0);
            
            try {
                // Start historical sync
                const client = this.babylonClient.get(network);
                if (client) {
                    await this.validatorHistoricalSync.startSync(network, client);
                }
            } catch (error) {
                logger.error(`[WebSocket] Error during historical sync setup for ${network}:`, error);
            }
            
            // Only set up core subscriptions on the default connection
            if (connectionId === 'default') {
                // Create optimized core subscriptions
                // Group related events to minimize the number of subscriptions
                const coreSubscriptions = [
                    {
                        // Subscription 1: BTC staking events
                        jsonrpc: '2.0',
                        method: 'subscribe',
                        id: 'btc_staking',
                        params: {
                            query: "tm.event='Tx' AND message.module='btcstaking'"
                        }
                    },
                    {
                        // Subscription 2: New blocks and checkpoints
                        jsonrpc: '2.0',
                        method: 'subscribe',
                        id: 'new_block_and_checkpoints',
                        params: {
                            query: "tm.event='NewBlock'"
                        }
                    },
                    {
                        // Subscription 3: Governance events
                        jsonrpc: '2.0',
                        method: 'subscribe',
                        id: 'governance',
                        params: {
                            query: "tm.event='Tx' AND message.module='gov'"
                        }
                    }
                ];

                // Count subscriptions
                for (const subscription of coreSubscriptions) {
                    // Increment subscription count
                    const currentCount = this.connectionSubscriptionCount.get(ws) || 0;
                    this.connectionSubscriptionCount.set(ws, currentCount + 1);
                    
                    // Send the subscription
                    ws.send(JSON.stringify(subscription));
                    logger.info(`[WebSocket] Core subscription ${subscription.id} sent to ${network}`);
                }
            }
        });

        ws.on('message', async (data: Buffer) => {
            try {
                const message = JSON.parse(data.toString());
                
                // Check if this is a subscription confirmation message
                if (message.result && !message.result.data) {
                    logger.info(`${network} subscription confirmed:`, message);
                    return;
                }

                const messageValue = message?.result?.data?.value;
                if (!messageValue) {
                    logger.info(`${network} received invalid message:`, message);
                    return;
                }

                // Process only for configured clients
                const processPromises: Promise<void>[] = [];

                // Handle events from combined subscriptions
                if (message.id === 'new_block_and_checkpoints') {
                    // Handle both new blocks and checkpoints from the same subscription
                    
                    // Check if this contains checkpoint data
                    if (messageValue.result_finalize_block && 
                        messageValue.result_finalize_block.events &&
                        Array.isArray(messageValue.result_finalize_block.events)) {
                        
                        // Check for BLS checkpoint events
                        const checkpointEvent = messageValue.result_finalize_block.events.find(
                            (event: any) => event.type === 'babylon.checkpointing.v1.EventCheckpointSealed'
                        );
                        
                        if (checkpointEvent) {
                            // Process as checkpoint
                            processPromises.push(
                                this.blsCheckpointService.handleCheckpoint(messageValue.result_finalize_block, network)
                            );
                        }
                    }
                    
                    // Process as new block for all new_block_and_checkpoints messages
                    processPromises.push(
                        this.checkpointStatusHandler.handleNewBlock(message, network)
                    );
                    
                    // Handle validator signatures for new blocks
                    if (message.result?.data?.type === 'tendermint/event/NewBlock') {
                        const blockData = message.result.data.value;
                        processPromises.push(
                            this.validatorSignatureService.handleNewBlock(blockData, network)
                        );
                    }
                }

                // Handle transactions from the 'btc_staking' or 'governance' subscriptions
                if ((message.id === 'btc_staking' || message.id === 'governance') && 
                    messageValue.TxResult?.result?.events) {
                    const height = parseInt(message.result.events['tx.height']?.[0]);
                    const txData = {
                        height,
                        hash: message.result.events['tx.hash']?.[0],
                        events: messageValue.TxResult.result.events
                    };

                    // Validate required fields
                    if (txData.height && txData.hash && txData.events) {
                        // Update health tracker with current height
                        processPromises.push(this.healthTracker.updateBlockHeight(network, height));
                        
                        if (message.id === 'btc_staking') {
                            // Handle BTC delegation events
                            processPromises.push(this.eventHandler.handleEvent(txData, network));
                            
                            // Handle Covenant events
                            processPromises.push(this.covenantEventHandler.handleEvent(txData, network));
                        } else if (message.id === 'governance') {
                            // Handle governance events
                            processPromises.push(this.governanceEventHandler.handleEvent(txData, network));
                        }
                    } else {
                        logger.info(`${network} transaction missing required fields:`, txData);
                    }
                }

                // Check for custom subscriptions
                if (this.subscriptions) {
                    // Find all subscriptions that match this message's transaction hash
                    const txHash = messageValue.TxResult?.tx_result?.hash || messageValue.TxHash;
                    
                    if (txHash) {
                        for (const [subscriptionId, subscription] of this.subscriptions.entries()) {
                            if (subscription.network === network && 
                                subscription.connection === ws) {
                                try {
                                    // Call the subscription callback
                                    subscription.callback({
                                        ...messageValue,
                                        TxHash: txHash
                                    });
                                } catch (error) {
                                    logger.error(`Error in subscription callback for ${subscriptionId}:`, error);
                                }
                            }
                        }
                    }
                }

                // Wait for all processes to complete
                if (processPromises.length > 0) {
                    await Promise.all(processPromises);
                }
            } catch (error) {
                logger.error(`Error processing ${network} message:`, error);
            }
        });

        ws.on('close', async () => {
            logger.info(`${network} websocket connection closed`);
            this.healthTracker.markDisconnected(network);
            await this.handleReconnect(network);
        });

        ws.on('error', (error) => {
            logger.error(`${network} websocket error:`, error);
            ws.close();
        });
    }

    private async handleReconnect(network: Network) {
        const attempts = this.reconnectAttempts.get(network) || 0;
        
        if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts.set(network, attempts + 1);
            logger.info(`[${network}] Attempting to reconnect (attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
            
            try {
                // Process only for configured clients
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
                logger.error(`[${network}] Error handling reconnection:`, error);
                // Retry even if there's an error
                this.handleReconnect(network);
            }
        } else {
            logger.error(`[${network}] Max reconnection attempts reached`);
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

    /**
     * Gets an available WebSocket connection for a new subscription
     * 
     * @param network - The network to get a connection for
     * @returns A WebSocket connection with available subscription slots
     */
    private getAvailableConnection(network: Network): WebSocket {
        const connections = network === Network.MAINNET ? this.mainnetConnections : this.testnetConnections;
        const wsUrl = network === Network.MAINNET ? process.env.BABYLON_WS_URL : process.env.BABYLON_TESTNET_WS_URL;
        
        if (!wsUrl) {
            throw new Error(`WebSocket URL for ${network} is not defined`);
        }
        
        // Try to find an existing connection with available slots
        for (const [id, connection] of connections.entries()) {
            const subscriptionCount = this.connectionSubscriptionCount.get(connection) || 0;
            
            if (connection.readyState === WebSocket.OPEN && 
                subscriptionCount < this.MAX_SUBSCRIPTIONS_PER_CONNECTION) {
                logger.debug(`Using existing ${network} connection ${id} with ${subscriptionCount} subscriptions`);
                return connection;
            }
        }
        
        // No available connections found, create a new one
        const newConnectionId = `${network}_${Date.now()}`;
        this.setupWebsocket(wsUrl, network, newConnectionId);
        
        // Get the newly created connection
        const newConnection = connections.get(newConnectionId);
        if (!newConnection) {
            throw new Error(`Failed to create new WebSocket connection for ${network}`);
        }
        
        logger.info(`Created new WebSocket connection for ${network}: ${newConnectionId}`);
        return newConnection;
    }

    /**
     * Subscribe to transaction events with specific filters
     * 
     * @param subscriptionId - Unique ID for this subscription
     * @param network - Network to subscribe on
     * @param filters - Object with key-value pairs for filtering transactions
     * @param callback - Function to call when a matching transaction is received
     */
    public subscribeToTx(
        subscriptionId: string,
        network: Network,
        filters: Record<string, any>,
        callback: (data: any) => void
    ): void {
        logger.info(`[WebSocket] Setting up subscription ${subscriptionId} on ${network}`);
        
        // Convert filters to Tendermint query format
        const queryParts = Object.entries(filters).map(([key, value]) => `${key}='${value}'`);
        const query = queryParts.join(' AND ');
        
        try {
            // Get an available connection (either existing with slots or new)
            const connection = this.getAvailableConnection(network);
            
            if (connection.readyState !== WebSocket.OPEN) {
                logger.warn(`[WebSocket] Connection not ready for ${subscriptionId}, will retry when connected`);
                // We could implement a queue system here to retry when the connection is ready
                return;
            }
            
            // Store subscription data for cleanup
            if (!this.subscriptions) {
                this.subscriptions = new Map();
            }
            
            this.subscriptions.set(subscriptionId, { network, connection, callback });
            
            // Increment subscription count for this connection
            const currentCount = this.connectionSubscriptionCount.get(connection) || 0;
            this.connectionSubscriptionCount.set(connection, currentCount + 1);
            
            // Send subscription request
            const subscription = {
                jsonrpc: '2.0',
                method: 'subscribe',
                id: subscriptionId,
                params: {
                    query: `tm.event='Tx' AND ${query}`
                }
            };
            
            connection.send(JSON.stringify(subscription));
            logger.info(`[WebSocket] Subscription ${subscriptionId} sent to ${network} (connection has ${currentCount + 1}/${this.MAX_SUBSCRIPTIONS_PER_CONNECTION} subscriptions)`);
        } catch (error) {
            logger.error(`[WebSocket] Error subscribing to ${subscriptionId} on ${network}:`, error);
        }
    }
    
    /**
     * Unsubscribe from all subscriptions with the given prefix
     * 
     * @param prefix - Prefix of subscription IDs to unsubscribe from
     */
    public unsubscribeAll(prefix: string): void {
        logger.info(`[WebSocket] Unsubscribing from all subscriptions with prefix: ${prefix}`);
        
        if (!this.subscriptions) {
            logger.warn(`[WebSocket] No subscriptions to unsubscribe from`);
            return;
        }
        
        // Find all subscriptions with the given prefix
        const subscriptionsToRemove: string[] = [];
        
        this.subscriptions.forEach((data, id) => {
            if (id.startsWith(prefix)) {
                const { connection } = data;
                
                if (connection && connection.readyState === WebSocket.OPEN) {
                    // Send unsubscribe request
                    const unsubscribe = {
                        jsonrpc: '2.0',
                        method: 'unsubscribe',
                        id: `unsub_${id}`,
                        params: {
                            query: id
                        }
                    };
                    
                    connection.send(JSON.stringify(unsubscribe));
                    
                    // Decrement subscription count for this connection
                    const currentCount = this.connectionSubscriptionCount.get(connection) || 0;
                    if (currentCount > 0) {
                        this.connectionSubscriptionCount.set(connection, currentCount - 1);
                    }
                }
                
                subscriptionsToRemove.push(id);
            }
        });
        
        // Remove subscriptions from map
        for (const id of subscriptionsToRemove) {
            this.subscriptions.delete(id);
        }
        
        logger.info(`[WebSocket] Unsubscribed from ${subscriptionsToRemove.length} subscriptions`);
    }
} 