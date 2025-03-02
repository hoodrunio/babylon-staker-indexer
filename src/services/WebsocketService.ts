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
    // Abonelik kuyruğu - bağlantı hazır olduğunda işlenecek
    private connectionReadyQueue: Map<Network, Array<{
        subscriptionId: string, 
        filters: Record<string, any>, 
        callback: (data: any) => void
    }>> = new Map();

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
                
                // Bağlantı açıldığında, kuyruktaki bekleyen abonelikleri işle
                logger.info(`Processing any pending subscription queue for ${network}`);
                setTimeout(() => this.processSubscriptionQueue(network), 1000);
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
                const rawData = data.toString();
                // Kısa log, çok büyük mesajları konsola yazdırmadan
                logger.debug(`[WebSocket][${network}] Raw message received of length ${rawData.length}`);
                
                // Error handling for JSON parsing
                let message;
                try {
                    message = JSON.parse(rawData);
                } catch (jsonError) {
                    logger.error(`[WebSocket][${network}] Failed to parse JSON message: ${rawData.slice(0, 10)}...`);
                    return;
                }
                
                // Trace full message for debugging (stringified and truncated to avoid huge logs)
                const messageStr = JSON.stringify(message);
                logger.debug(`[WebSocket][${network}] Parsed message: ${messageStr.slice(0, 10)}${messageStr.length > 500 ? '...' : ''}`);
                
                // Check if this is a subscription confirmation message
                if (message.result && message.result.query && !message.result.data) {
                    logger.info(`[WebSocket][${network}] Subscription confirmed for query: ${message.result.query}`);
                    return;
                }

                // Check for errors in the response
                if (message.error) {
                    logger.error(`[WebSocket][${network}] Error in message: ${JSON.stringify(message.error)}`);
                    return;
                }

                // Examine message for TX events - 3 possible formats
                
                // Format 1: Tendermint event with type 'tendermint/event/Tx'
                if (message?.result?.data?.type === 'tendermint/event/Tx') {
                    logger.info(`[WebSocket][${network}] Transaction event received: tendermint/event/Tx format`);
                    
                    // Extract tx hash from events
                    let txHash = '';
                    if (message.result?.events && message.result.events['tx.hash']) {
                        txHash = message.result.events['tx.hash'][0];
                        logger.info(`[WebSocket][${network}] Received TX with hash: ${txHash}`);
                    }
                    
                    // Route message to all TX subscriptions for this network
                    if (this.subscriptions) {
                        let routeCount = 0;
                        for (const [subId, subscription] of this.subscriptions.entries()) {
                            if (subscription.network === network) {
                                try {
                                    logger.debug(`[WebSocket][${network}] Routing TX to subscription: ${subId}`);
                                    subscription.callback(message);
                                    routeCount++;
                                } catch (callbackError) {
                                    logger.error(`[WebSocket][${network}] Error in subscription callback for ${subId}:`, callbackError);
                                }
                            }
                        }
                        logger.debug(`[WebSocket][${network}] Routed TX to ${routeCount} subscriptions`);
                    }
                    
                    return;
                }
                
                // Format 2: Result data with TxResult
                if (message?.result?.data?.value?.TxResult) {
                    logger.info(`[WebSocket][${network}] Transaction event received: TxResult format`);
                    
                    // Extract tx hash - multiple possible locations
                    let txHash = '';
                    if (message.result?.events && message.result.events['tx.hash']) {
                        txHash = message.result.events['tx.hash'][0];
                    } else if (message.result?.data?.value?.TxResult?.hash) {
                        txHash = message.result.data.value.TxResult.hash;
                    }
                    
                    if (txHash) {
                        logger.info(`[WebSocket][${network}] Received TX with hash: ${txHash}`);
                    }
                    
                    // Route to appropriate subscriptions
                    if (this.subscriptions) {
                        let routeCount = 0;
                        for (const [subId, subscription] of this.subscriptions.entries()) {
                            if (subscription.network === network) {
                                try {
                                    logger.debug(`[WebSocket][${network}] Routing TX to subscription: ${subId}`);
                                    subscription.callback(message);
                                    routeCount++;
                                } catch (callbackError) {
                                    logger.error(`[WebSocket][${network}] Error in subscription callback for ${subId}:`, callbackError);
                                }
                            }
                        }
                        logger.debug(`[WebSocket][${network}] Routed TX to ${routeCount} subscriptions`);
                    }
                    
                    return;
                }

                // Format 3: Check for core subscriptions (btc_staking, etc.)
                if (message.id && message.result?.data?.value) {
                    // Process core subscriptions
                    const messageValue = message.result.data.value;
                    
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

                    // Wait for all processes to complete
                    if (processPromises.length > 0) {
                        await Promise.all(processPromises);
                    }
                    
                    return;
                }
                
                // Unknown message format - log for debugging
                logger.debug(`[WebSocket][${network}] Received message with unknown format: ${JSON.stringify(message).slice(0, 10)}...`);
                
            } catch (error) {
                logger.error(`[WebSocket][${network}] Error processing message:`, error instanceof Error ? error.stack : error);
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
        
        // Önce mevcut açık bağlantıları kontrol et
        for (const [id, connection] of connections.entries()) {
            const subscriptionCount = this.connectionSubscriptionCount.get(connection) || 0;
            
            if (connection.readyState === WebSocket.OPEN && 
                subscriptionCount < this.MAX_SUBSCRIPTIONS_PER_CONNECTION) {
                logger.debug(`Using existing ${network} connection ${id} with ${subscriptionCount} subscriptions`);
                return connection;
            }
        }
        
        // Eğer hiç açık bağlantı yoksa, mevcut bağlantıları temizle ve yeni oluştur
        const defaultConnection = network === Network.MAINNET ? this.mainnetWs : this.testnetWs;
        
        // Eğer default bağlantı var ve durumu CONNECTING ise (açılmayı bekliyor)
        if (defaultConnection && defaultConnection.readyState === WebSocket.CONNECTING) {
            logger.info(`Default connection for ${network} is connecting. Using it while waiting to open.`);
            return defaultConnection;
        }
        
        // Yeni bağlantı oluştur
        const newConnectionId = `${network}_${Date.now()}`;
        this.setupWebsocket(wsUrl, network, newConnectionId);
        
        // Yeni oluşturulan bağlantıyı al
        const newConnection = connections.get(newConnectionId);
        if (!newConnection) {
            throw new Error(`Failed to create new WebSocket connection for ${network}`);
        }
        
        logger.info(`Created new WebSocket connection for ${network}: ${newConnectionId}`);
        
        // Bağlantı hazır olmasa bile, kuyruk sistemi ile daha sonra işlenecek abonelikler için bağlantıyı dön
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
        
        try {
            // Filtre query'sini oluştur, eğer filtreleme yoksa sadece 'tm.event='Tx'' kullan
            let query = "tm.event='Tx'";
            
            // NOT: Tendermint subscription filtreleri gerçekte çalışmıyor
            // Bu nedenle tüm işlemleri dinleyip, gelen sonuçları kod içinde filtreleyelim
            logger.warn(`[WebSocket] Filter parameters for subscription ${subscriptionId} cannot be applied at Tendermint level. Will apply filters in callback.`);
            logger.debug(`[WebSocket] Original filters: ${JSON.stringify(filters)}`);
            
            // Bağlantı al
            const connection = this.getAvailableConnection(network);
            
            if (connection.readyState !== WebSocket.OPEN) {
                logger.warn(`[WebSocket] Connection not ready for ${subscriptionId}, adding to queue for retry`);
                
                // Bağlantı hazır olmadığında kuyruğa ekle
                if (!this.connectionReadyQueue.has(network)) {
                    this.connectionReadyQueue.set(network, []);
                }
                
                this.connectionReadyQueue.get(network)?.push({
                    subscriptionId,
                    filters,
                    callback
                });
                
                // Kuyruktaki abonelikleri belirli aralıklarla kontrol et ve yeniden dene
                setTimeout(() => this.processSubscriptionQueue(network), 5000);
                return;
            }
            
            // Abonelik verilerini temizleme işlemi için sakla
            if (!this.subscriptions) {
                this.subscriptions = new Map();
            }
            
            // Orijinal callback'i sakla
            const originalCallback = callback;
            
            // Filtreyi uygulayan yeni callback oluştur
            const filteredCallback = (data: any) => {
                // Filtreleri kontrol et
                const applyFilters = this.checkFilters(data, filters);
                
                // Eğer filtreler eşleşiyorsa callback'i çağır
                if (applyFilters) {
                    originalCallback(data);
                }
            };
            
            this.subscriptions.set(subscriptionId, { network, connection, callback: filteredCallback });
            
            // Bağlantının abonelik sayısını artır
            const currentCount = this.connectionSubscriptionCount.get(connection) || 0;
            this.connectionSubscriptionCount.set(connection, currentCount + 1);
            
            // Abonelik isteği gönder
            const subscription = {
                jsonrpc: '2.0',
                method: 'subscribe',
                id: subscriptionId,
                params: {
                    query: query
                }
            };
            
            // İsteği gönder ve log'a yaz
            connection.send(JSON.stringify(subscription));
            logger.info(`[WebSocket] Subscription ${subscriptionId} sent to ${network} (connection has ${currentCount + 1}/${this.MAX_SUBSCRIPTIONS_PER_CONNECTION} subscriptions)`);
            
            // Aboneliğin durumunu 10 saniye sonra kontrol et
            setTimeout(() => {
                if (this.subscriptions?.has(subscriptionId)) {
                    logger.debug(`[WebSocket] Subscription ${subscriptionId} is still active`);
                } else {
                    logger.warn(`[WebSocket] Subscription ${subscriptionId} may not have been established. Retrying...`);
                    this.subscribeToTx(subscriptionId, network, filters, originalCallback);
                }
            }, 10000);
        } catch (error) {
            logger.error(`[WebSocket] Error subscribing to ${subscriptionId} on ${network}:`, error);
            
            // Hata durumunda daha sonra tekrar dene
            setTimeout(() => {
                logger.info(`[WebSocket] Retrying subscription ${subscriptionId} after error`);
                this.subscribeToTx(subscriptionId, network, filters, callback);
            }, 5000);
        }
    }
    
    /**
     * Gelen veriyi filtrelerle karşılaştırır
     */
    private checkFilters(data: any, filters: Record<string, any>): boolean {
        // Filtre yoksa her zaman true döndür
        if (!filters || Object.keys(filters).length === 0) {
            return true;
        }
        
        // Olay verileri yoksa filtreleme yapılamaz
        if (!data?.result?.events) {
            return false;
        }
        
        const events = data.result.events;
        
        // Tüm filtreleri kontrol et
        for (const [key, value] of Object.entries(filters)) {
            // Noktalarla ayrılmış anahtarları böl
            const keyParts = key.split('.');
            
            // Sadece iki parçalı anahtarları destekle (örn: 'message.module')
            if (keyParts.length === 2) {
                const category = keyParts[0];
                const field = keyParts[1];
                const eventKey = `${category}.${field}`;
                
                // Olay anahtarı olup olmadığını kontrol et
                if (!events[eventKey] || !Array.isArray(events[eventKey])) {
                    logger.debug(`[WebSocket] Filter key ${eventKey} not found in events or not an array`);
                    return false;
                }
                
                // Değer bir dizi içinde olabilir
                if (!events[eventKey].includes(value.toString())) {
                    logger.debug(`[WebSocket] Filter value ${value} not found in event ${eventKey}`);
                    return false;
                }
            } else {
                logger.warn(`[WebSocket] Unsupported filter key format: ${key}`);
                return false;
            }
        }
        
        // Tüm filtreler eşleşiyorsa true döndür
        return true;
    }
    
    /**
     * Kuyruktaki abonelikleri işler ve bağlantı hazır olduğunda yeniden dener
     */
    private processSubscriptionQueue(network: Network): void {
        const queue = this.connectionReadyQueue.get(network);
        if (!queue || queue.length === 0) {
            return;
        }
        
        logger.info(`[WebSocket] Processing subscription queue for ${network}, ${queue.length} items`);
        
        // Bağlantıyı al
        try {
            const connection = this.getAvailableConnection(network);
            
            if (connection.readyState === WebSocket.OPEN) {
                const queueCopy = [...queue]; // Kopyasını al, çünkü işlerken kuyruk değişebilir
                this.connectionReadyQueue.set(network, []); // Kuyruğu temizle
                
                // Kuyruktaki her aboneliği işle
                for (const item of queueCopy) {
                    logger.info(`[WebSocket] Retrying subscription ${item.subscriptionId} from queue`);
                    // Başarısız abonelik denemelerini önlemek için bir daha queueing yapmadan direk abone ol
                    try {
                        if (connection.readyState === WebSocket.OPEN) {
                            // Abonelik verilerini temizleme işlemi için sakla
                            if (!this.subscriptions) {
                                this.subscriptions = new Map();
                            }
                            
                            this.subscriptions.set(item.subscriptionId, { network, connection, callback: item.callback });
                            
                            // Bağlantının abonelik sayısını artır
                            const currentCount = this.connectionSubscriptionCount.get(connection) || 0;
                            this.connectionSubscriptionCount.set(connection, currentCount + 1);
                            
                            // Kesinlikle çalışan Tendermint abonelik formatı
                            // Filtre varsa ekle, yoksa tüm işlemler
                            let query = "tm.event='Tx'";
                            if (item.filters && Object.keys(item.filters).length > 0) {
                                const queryParts = Object.entries(item.filters).map(([key, value]) => `${key}='${value}'`);
                                const filterQuery = queryParts.join(' AND ');
                                query = `${query} AND ${filterQuery}`;
                            }
                            
                            // Abonelik isteği gönder
                            const subscription = {
                                jsonrpc: "2.0",
                                id: item.subscriptionId,
                                method: "subscribe",
                                params: {
                                    query: query
                                }
                            };
                            
                            // İsteği gönder ve log'a yaz
                            const jsonStr = JSON.stringify(subscription);
                            logger.debug(`[WebSocket] Sending subscription request from queue: ${jsonStr}`);
                            connection.send(jsonStr);
                            logger.info(`[WebSocket] Queue subscription ${item.subscriptionId} sent to ${network}`);
                        } else {
                            logger.warn(`[WebSocket] Connection not ready when processing queue item ${item.subscriptionId}, re-adding to queue`);
                            if (!this.connectionReadyQueue.has(network)) {
                                this.connectionReadyQueue.set(network, []);
                            }
                            this.connectionReadyQueue.get(network)?.push(item);
                        }
                    } catch (itemError) {
                        logger.error(`[WebSocket] Error processing queue item ${item.subscriptionId}:`, itemError);
                        // Hata durumunda yeniden kuyruğa ekle
                        if (!this.connectionReadyQueue.has(network)) {
                            this.connectionReadyQueue.set(network, []);
                        }
                        this.connectionReadyQueue.get(network)?.push(item);
                    }
                }
                
                // Kuyrukta hala işlem var mı kontrol et - hata durumunda tekrar eklenmiş olabilir
                const remainingQueue = this.connectionReadyQueue.get(network);
                if (remainingQueue && remainingQueue.length > 0) {
                    logger.info(`[WebSocket] ${remainingQueue.length} items remain in queue after processing, will retry later`);
                    setTimeout(() => this.processSubscriptionQueue(network), 5000);
                } else {
                    logger.info(`[WebSocket] Successfully processed all items in subscription queue for ${network}`);
                }
            } else {
                // Hala hazır değilse, daha sonra tekrar dene
                logger.warn(`[WebSocket] Connection still not ready for ${network}, will retry queue later. Connection state: ${connection.readyState}`);
                setTimeout(() => this.processSubscriptionQueue(network), 5000);
            }
        } catch (error) {
            logger.error(`[WebSocket] Error processing subscription queue for ${network}:`, error);
            setTimeout(() => this.processSubscriptionQueue(network), 5000);
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

    /**
     * Tendermint/Cosmos API'si için doğrudan abonelik oluşturur - daha doğrudan ve kesin bir yaklaşım
     * 
     * @param subscriptionId - Unique ID for this subscription
     * @param network - Network to subscribe on
     * @param callback - Function to call when a matching transaction is received
     */
    public subscribeTendermint(
        subscriptionId: string,
        network: Network,
        callback: (data: any) => void
    ): void {
        logger.info(`[WebSocket] Setting up Tendermint subscription ${subscriptionId} on ${network}`);
        
        try {
            // Bağlantı al
            const connection = this.getAvailableConnection(network);
            
            if (connection.readyState !== WebSocket.OPEN) {
                logger.warn(`[WebSocket] Connection not ready for ${subscriptionId}, adding to queue for retry`);
                
                // Bağlantı hazır olmadığında kuyruğa ekle
                if (!this.connectionReadyQueue.has(network)) {
                    this.connectionReadyQueue.set(network, []);
                }
                
                this.connectionReadyQueue.get(network)?.push({
                    subscriptionId,
                    filters: {}, // Boş filtre kullan
                    callback
                });
                
                // Kuyruktaki abonelikleri belirli aralıklarla kontrol et ve yeniden dene
                setTimeout(() => this.processSubscriptionQueue(network), 5000);
                return;
            }
            
            // Abonelik verilerini temizleme işlemi için sakla
            if (!this.subscriptions) {
                this.subscriptions = new Map();
            }
            
            this.subscriptions.set(subscriptionId, { network, connection, callback });
            
            // Bağlantının abonelik sayısını artır
            const currentCount = this.connectionSubscriptionCount.get(connection) || 0;
            this.connectionSubscriptionCount.set(connection, currentCount + 1);
            
            // Kesinlikle çalışan Tendermint abonelik formatı
            // "tm.event='Tx'" sorgusu tüm işlemleri alır
            const subscription = {
                jsonrpc: "2.0",
                id: subscriptionId,
                method: "subscribe",
                params: {
                    query: "tm.event='Tx'"
                }
            };
            
            // İsteği gönder ve log'a yaz
            const jsonStr = JSON.stringify(subscription);
            logger.debug(`[WebSocket] Sending subscription request: ${jsonStr}`);
            connection.send(jsonStr);
            logger.info(`[WebSocket] Tendermint subscription ${subscriptionId} sent to ${network}`);
            
            // Aboneliğin durumunu 10 saniye sonra kontrol et
            setTimeout(() => {
                if (this.subscriptions?.has(subscriptionId)) {
                    logger.debug(`[WebSocket] Subscription ${subscriptionId} is still active`);
                } else {
                    logger.warn(`[WebSocket] Subscription ${subscriptionId} may not have been established. Retrying...`);
                    this.subscribeTendermint(subscriptionId, network, callback);
                }
            }, 10000);
        } catch (error) {
            logger.error(`[WebSocket] Error subscribing to ${subscriptionId} on ${network}:`, error);
            
            // Hata durumunda daha sonra tekrar dene
            setTimeout(() => {
                logger.info(`[WebSocket] Retrying Tendermint subscription ${subscriptionId} after error`);
                this.subscribeTendermint(subscriptionId, network, callback);
            }, 5000);
        }
    }
} 