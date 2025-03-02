import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { BBNTransaction, BBNAccount } from '../../database/models';
import { 
    BBNTransactionType, 
    BBNTransactionData,
    BBNTransactionStatus
} from '../../types/bbn';
import { logger } from '../../utils/logger';
import { CacheService } from '../CacheService';
import { WebsocketService } from '../WebsocketService';
import { BBNTransactionParser } from './BBNTransactionParser';
import { decodeTx } from '../../decoders/transaction';
import { BBNStakingProcessor } from './BBNStakingProcessor';
import { BBNTransactionCache } from './BBNTransactionCache';
import { IBBNTransactionIndexer } from './interfaces/IBBNTransactionIndexer';
import { IBBNTransactionParser } from './interfaces/IBBNTransactionParser';
import { IBBNTransactionCache } from './interfaces/IBBNTransactionCache';
import { IBBNStakingProcessor } from './interfaces/IBBNStakingProcessor';

/**
 * BBN İşlem İndeksleyici - İşlemleri zincirden takip eder ve veritabanında indexler
 */
export class BBNTransactionIndexer implements IBBNTransactionIndexer {
    private static instance: BBNTransactionIndexer | null = null;
    private babylonClient: BabylonClient;
    private cacheService: CacheService;
    private stakingProcessor: IBBNStakingProcessor;
    private transactionCache: IBBNTransactionCache;
    private transactionParser: IBBNTransactionParser;
    private isRunning: boolean = false;
    private currentHeight: number = 0;
    private readonly network: Network;
    
    private constructor(
        network: Network = Network.MAINNET,
        babylonClient?: BabylonClient,
        cacheService?: CacheService,
        stakingProcessor?: IBBNStakingProcessor,
        transactionCache?: IBBNTransactionCache,
        transactionParser?: IBBNTransactionParser
    ) {
        this.network = network;
        this.babylonClient = babylonClient || BabylonClient.getInstance(network);
        this.cacheService = cacheService || CacheService.getInstance();
        this.stakingProcessor = stakingProcessor || BBNStakingProcessor.getInstance(network);
        this.transactionCache = transactionCache || BBNTransactionCache.getInstance(network);
        this.transactionParser = transactionParser || BBNTransactionParser.getInstance();
    }

    public static getInstance(
        network: Network = Network.MAINNET,
        babylonClient?: BabylonClient,
        cacheService?: CacheService,
        stakingProcessor?: IBBNStakingProcessor,
        transactionCache?: IBBNTransactionCache,
        transactionParser?: IBBNTransactionParser
    ): BBNTransactionIndexer {
        if (!BBNTransactionIndexer.instance) {
            BBNTransactionIndexer.instance = new BBNTransactionIndexer(
                network,
                babylonClient,
                cacheService,
                stakingProcessor,
                transactionCache,
                transactionParser
            );
        }
        return BBNTransactionIndexer.instance;
    }

    /**
     * Starts the indexer
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('BBNTransactionIndexer is already running');
            return;
        }

        this.isRunning = true;
        logger.info(`Starting BBNTransactionIndexer for ${this.network}`);

        try {
            // Önce WebsocketService'i başlat
            logger.info(`Ensuring WebsocketService is started before historical sync`);
            const websocketService = WebsocketService.getInstance();
            websocketService.startListening();
            
            // WebsocketService'in bağlantı kurması için biraz bekle
            logger.info(`Waiting for WebSocket connections to initialize...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Get the current blockchain height
            this.currentHeight = await this.babylonClient.getCurrentHeight();
            logger.info(`Current blockchain height: ${this.currentHeight}`);
            
            // Önce historical sync'i tamamla
            await this.syncHistoricalData();
            
            // Historical sync tamamlandıktan sonra websocket dinleyicilerini kur
            logger.info(`Historical sync completed, setting up websocket listeners for real-time updates`);
            await this.setupWebsocketListeners();
            
            // Websocket dinleyicilerinin doğru çalıştığından emin ol
            this.ensureWebsocketConnection();
            
            logger.info(`BBNTransactionIndexer started successfully and listening for real-time updates`);
        } catch (error) {
            logger.error('Error starting BBNTransactionIndexer:', error);
            this.isRunning = false;
        }
    }

    /**
     * WebsocketService'in bağlantısının açık olduğundan emin olur
     */
    private ensureWebsocketConnection(): void {
        try {
            const websocketService = WebsocketService.getInstance();
            
            // Eğer WebsocketService start metodu yoksa veya start edilmemişse, başlat
            if (typeof websocketService.startListening === 'function') {
                websocketService.startListening();
                logger.info(`Ensured WebsocketService is started and listening`);
            }
            
            // Eğer abonelikler kurulamamışsa, tekrar dene
            setTimeout(() => {
                this.setupWebsocketListeners();
                logger.info(`Re-attempted to setup websocket listeners to ensure connection`);
            }, 5000); // 5 saniye sonra tekrar dene
        } catch (error) {
            logger.error(`Error ensuring websocket connection:`, error);
        }
    }

    /**
     * Stops the indexer
     */
    public stop(): void {
        if (!this.isRunning) {
            logger.warn('BBNTransactionIndexer is not running');
            return;
        }

        this.isRunning = false;
        logger.info('Stopping BBNTransactionIndexer');
        
        try {
            // Clean up websocket subscriptions
            const websocketService = WebsocketService.getInstance();
            websocketService.unsubscribeAll(`bbn_tx_indexer_${this.network}`);
            
            // Release any locks or resources
            this.cacheService.del(`bbn_tx_indexer_lock_${this.network}`);
            
            logger.info('BBNTransactionIndexer stopped successfully');
        } catch (error) {
            logger.error('Error while stopping BBNTransactionIndexer:', error);
        }
    }

    /**
     * Sets up websocket listeners for new transactions
     */
    private async setupWebsocketListeners(): Promise<void> {
        logger.info('Setting up websocket listeners for new transactions');
        
        try {
            const websocketService = WebsocketService.getInstance();
            
            // Yeni Tendermint abonelik metodunu kullan - daha basit ve güvenilir
            websocketService.subscribeTendermint(
                `bbn_tx_indexer_${this.network}_all`,
                this.network,
                async (data: any) => {
                    try {
                        logger.info(`Received transaction from websocket - type: ${data?.result?.data?.type || 'unknown'}`);
                        logger.debug(`Transaction raw data: ${JSON.stringify(data).slice(0, 500)}...`);
                        
                        // TX Hash'i bul
                        let txHash: string = '';
                        if (data?.result?.events && data.result.events['tx.hash']) {
                            txHash = data.result.events['tx.hash'][0];
                            logger.info(`Processing transaction with hash: ${txHash}`);
                        } else {
                            const extractedHash = this.extractTxHash(data);
                            if (!extractedHash) {
                                logger.warn(`Received transaction without hash, trying to extract from data`);
                                // JSON içeriğini kontrol et
                                logger.debug(`Transaction data structure: ${JSON.stringify(data).slice(0, 300)}...`);
                                return;
                            }
                            txHash = extractedHash;
                            logger.info(`Found transaction hash via extraction: ${txHash}`);
                        }
                        
                        try {
                            // Doğrudan websocket mesajından parse etmeyi dene
                            const parsedTx = this.parseTransactionFromWebsocket(data);
                            
                            if (parsedTx) {
                                logger.info(`Successfully parsed transaction from websocket: ${parsedTx.txHash}, type: ${parsedTx.type}`);
                                await this.processTransaction(parsedTx);
                            } else {
                                logger.info(`Could not parse from websocket directly, falling back to RPC for: ${txHash}`);
                                
                                // Websocket'ten parse edemedik, RPC yöntemine geri dön
                                // Mesaj tipini bul
                                let msgType = '';
                                if (data?.result?.events && data.result.events['message.action'] && data.result.events['message.action'][0]) {
                                    msgType = data.result.events['message.action'][0];
                                    logger.info(`Message type from events: ${msgType}`);
                                }
                                
                                // İşlemi RPC üzerinden detaylı getir
                                /* logger.info(`Fetching full transaction details for hash: ${txHash}`);
                                const fullTx = await this.babylonClient.getTransaction(txHash);
                                if (!fullTx) {
                                    logger.warn(`Transaction not found: ${txHash}`);
                                    return;
                                }
                                
                                // JSON.stringify ile tüm nesneyi basmak önemli
                                logger.debug(`Full transaction: ${JSON.stringify(fullTx).slice(0, 500)}...`);
                                
                                // Mesaj tipini al
                                if (!msgType) {
                                    msgType = this.extractMessageType(fullTx);
                                    logger.info(`Message type from transaction: ${msgType}`);
                                }
                                
                                // Transactioni parse et
                                const parsedTx = this.transactionParser.parseTransaction(fullTx, msgType, this.network);
                                if (parsedTx) {
                                    logger.info(`Successfully parsed transaction: ${parsedTx.txHash}, type: ${parsedTx.type}`);
                                    await this.processTransaction(parsedTx);
                                } else {
                                    logger.warn(`Failed to parse transaction with hash: ${txHash}`);
                                } */
                            }
                        } catch (parseError) {
                            logger.error(`Error parsing transaction: ${txHash}`, parseError);
                            
                            // Hata olduğunda RPC yöntemine geri dön
                            logger.info(`Fallback to RPC due to parse error for transaction: ${txHash}`);
                            
                            // İşlemi RPC üzerinden detaylı getir
                            const fullTx = await this.babylonClient.getTransaction(txHash);
                            if (!fullTx) {
                                logger.warn(`Transaction not found: ${txHash}`);
                                return;
                            }
                            
                            // Mesaj tipini al
                            const msgType = this.extractMessageType(fullTx);
                            
                            // Transactioni parse et
                            const parsedTx = this.transactionParser.parseTransaction(fullTx, msgType, this.network);
                            if (parsedTx) {
                                logger.info(`Successfully parsed transaction using RPC fallback: ${parsedTx.txHash}, type: ${parsedTx.type}`);
                                await this.processTransaction(parsedTx);
                            } else {
                                logger.warn(`Failed to parse transaction with hash: ${txHash}`);
                            }
                        }
                    } catch (error) {
                        const txHash = this.extractTxHash(data) || 'unknown';
                        
                        if (error instanceof Error) {
                            logger.error(`Error processing transaction from websocket: ${txHash}, Error: ${error.message}, Stack: ${error.stack}`);
                        } else {
                            logger.error(`Unknown error processing transaction from websocket: ${txHash}`, error);
                        }
                    }
                }
            );
            
            logger.info(`WebSocket listeners set up successfully for network: ${this.network}`);
        } catch (error) {
            logger.error(`Error setting up WebSocket listeners for network ${this.network}:`, error);
            throw error;
        }
    }
    
    /**
     * İşlem hash değerini veri içinden çıkarır
     */
    private extractTxHash(data: any): string | null {
        return data.TxHash || 
              (data.result && data.result.events && data.result.events['tx.hash'] && data.result.events['tx.hash'][0]) || 
              data.txhash || 
              data.hash || null;
    }
    
    /**
     * İşlem mesaj tipini çıkarır
     */
    private extractMessageType(tx: any): string {
        let msgType = '';
        if (tx.tx && tx.tx.body && tx.tx.body.messages && tx.tx.body.messages.length > 0) {
            msgType = tx.tx.body.messages[0]['@type'] || '';
        } else if (tx.tx_response && tx.tx_response.tx && tx.tx_response.tx.body && 
                  tx.tx_response.tx.body.messages && tx.tx_response.tx.body.messages.length > 0) {
            msgType = tx.tx_response.tx.body.messages[0]['@type'] || '';
        }
        return msgType;
    }
    
    /**
     * Doğrudan websocket mesajından işlem bilgilerini ayıklar
     */
    private parseTransactionFromWebsocket(data: any): BBNTransactionData | null {
        try {
            // Temel kontroller
            if (!data?.result?.events) {
                logger.debug('No events found in websocket data');
                return null;
            }
            
            const events = data.result.events;
            
            // Zorunlu alanları kontrol et
            if (!events['tx.hash'] || !events['tx.height']) {
                logger.debug('Required fields missing in websocket data');
                return null;
            }
            
            // Temel bilgileri çıkar
            const txHash = events['tx.hash'][0];
            const height = parseInt(events['tx.height'][0]);
            const timestamp = Math.floor(Date.now() / 1000); // Şu anki zaman
            
            // Gönderen ve alıcı
            const sender = events['message.sender']?.[0] || events['coin_spent.spender']?.[0] || '';
            const receiver = events['transfer.recipient']?.[0] || events['coin_received.receiver']?.[0] || '';
            
            logger.debug(`Extracted sender: ${sender}, receiver: ${receiver} from websocket data`);
            
            // Miktar ve para birimi
            let amount = "0";
            let denom = "";
            if (events['transfer.amount'] && events['transfer.amount'][0]) {
                const amountStr = events['transfer.amount'][0];
                // "12523ubbn" formatından sayı ve denom ayır
                const match = amountStr.match(/^(\d+)(.+)$/);
                if (match) {
                    amount = match[1];
                    denom = match[2];
                }
            } else if (events['coin_spent.amount'] && events['coin_spent.amount'][0]) {
                const amountStr = events['coin_spent.amount'][0];
                const match = amountStr.match(/^(\d+)(.+)$/);
                if (match) {
                    amount = match[1];
                    denom = match[2];
                }
            }
            
            logger.debug(`Extracted amount: ${amount}, denom: ${denom} from websocket data`);
            
            // İşlem tipini belirle
            let type = BBNTransactionType.OTHER;
            
            // Modül ve eylem bilgisini çıkar
            const modules = events['message.module'] || [];
            const actions = events['message.action'] || [];
            
            // İşlem tipini belirle
            if (modules.includes('bank') && actions.some((a: string) => a.includes('send'))) {
                type = BBNTransactionType.TRANSFER;
            } else if (modules.includes('staking')) {
                if (actions.some((a: string) => a.includes('delegate'))) {
                    type = BBNTransactionType.STAKE;
                } else if (actions.some((a: string) => a.includes('undelegate') || a.includes('unbond'))) {
                    type = BBNTransactionType.UNSTAKE;
                } else if (actions.some((a: string) => a.includes('redelegate'))) {
                    type = BBNTransactionType.STAKE;
                }
            } else if (modules.includes('epoching')) {
                // Babylon epoching modülü kontrolü
                logger.debug(`Detected epoching module with actions: ${actions.join(', ')}`);
                
                if (actions.some((a: string) => a.includes('wrapped_delegate'))) {
                    type = BBNTransactionType.STAKE;
                    logger.info(`Detected wrapped delegate transaction: ${txHash}`);
                } else if (actions.some((a: string) => a.includes('wrapped_undelegate'))) {
                    type = BBNTransactionType.UNSTAKE;
                    logger.info(`Detected wrapped undelegate transaction: ${txHash}`);
                }
            } else if (modules.includes('distribution') && actions.some((a: string) => a.includes('withdraw'))) {
                type = BBNTransactionType.REWARD;
            } else if (modules.includes('btcstaking')) {
                // BBNTransactionType.BTC_STAKING'i destekliyorsa kullan, yoksa OTHER kullan
                type = BBNTransactionType.OTHER; // Önceden tanımlanmış bir değerle değiştirildi
            } else if (modules.includes('gov')) {
                // BBNTransactionType.GOVERNANCE'i destekliyorsa kullan, yoksa OTHER kullan
                type = BBNTransactionType.OTHER; // Önceden tanımlanmış bir değerle değiştirildi
            }
            
            // Özel durum: wasm modülü için daha detaylı inceleme
            if (modules.includes('wasm')) {
                // Wasm mesajlarında modül wasm olup, eylem farklı olabiliyor
                if (events['wasm.action']) {
                    const wasmActions = events['wasm.action'];
                    if (wasmActions.includes('delegate') || wasmActions.includes('stake')) {
                        type = BBNTransactionType.STAKE;
                    } else if (wasmActions.includes('undelegate') || wasmActions.includes('unstake') || wasmActions.includes('unbond')) {
                        type = BBNTransactionType.UNSTAKE;
                    } else if (wasmActions.includes('transfer')) {
                        type = BBNTransactionType.TRANSFER;
                    } else if (wasmActions.includes('withdraw')) {
                        type = BBNTransactionType.REWARD;
                    }
                }
            }
            
            logger.debug(`Determined transaction type: ${type} from websocket data`);
            
            // Ücret
            let fee = '0';
            if (events['tx.fee'] && events['tx.fee'][0]) {
                const feeStr = events['tx.fee'][0];
                const feeMatch = feeStr.match(/^(\d+)/);
                if (feeMatch) {
                    fee = feeMatch[1];
                }
            }
            
            // Memo (genellikle websocket verilerinde yok, boş bırakıyoruz)
            const memo = '';
            
            // Sonuç oluştur
            return {
                txHash,
                blockHeight: height,
                type,
                status: BBNTransactionStatus.SUCCESS, // Enum değerini kullan
                sender,
                receiver,
                amount: Number(amount), // Number tipine dönüştür
                denom,
                fee: Number(fee), // Number tipine dönüştür
                memo,
                timestamp,
                networkType: this.network
            };
        } catch (error) {
            logger.error(`Error parsing transaction from websocket:`, error);
            return null;
        }
    }
    
    /**
     * Syncs historical transaction data
     */
    private async syncHistoricalData(): Promise<void> {
        logger.info('Syncing historical transaction data');
        
        try {
            // Get the latest transaction from the database to determine starting point
            const latestTransaction = await BBNTransaction.findOne({
                where: { networkType: this.network },
                order: [['blockHeight', 'DESC']]
            });
            
            // Get the current block height from the client
            const currentBlock = await this.babylonClient.getLatestBlock();
            const currentHeight = currentBlock.header.height;
            
            // Determine the starting height (sync latest 1000 blocks if no existing transactions)
            const startHeight = latestTransaction ? latestTransaction.blockHeight + 1 : Math.max(1, currentHeight - 5);
            
            logger.info(`Syncing transaction data from block ${startHeight} to ${currentHeight} for network: ${this.network}`);
            
            // Process blocks in batches to avoid memory issues
            const BATCH_SIZE = 100;
            for (let height = startHeight; height <= currentHeight; height += BATCH_SIZE) {
                const endHeight = Math.min(height + BATCH_SIZE - 1, currentHeight);
                
                // Process each block in the batch
                for (let blockHeight = height; blockHeight <= endHeight; blockHeight++) {
                    await this.processBlock(blockHeight);
                }
                
                logger.info(`Completed syncing blocks ${height} to ${endHeight} for network: ${this.network}`);
            }
            
            logger.info(`Completed historical transaction data sync for network: ${this.network}`);
        } catch (error) {
            logger.error(`Error syncing historical transaction data for network ${this.network}:`, error);
            throw error;
        }
    }

    /**
     * Processes a single block for BBN transactions
     */
    public async processBlock(height: number): Promise<void> {
        try {
            logger.debug(`[BBNTransactionIndexer] Processing block ${height} for ${this.network}`);
            
            // Get block data
            const block = await this.babylonClient.getBlockResults(height);
            if (!block) {
                logger.warn(`Block ${height} not found for ${this.network}`);
                return;
            }
            
            // Get transactions for this block
            const txSearchResult = await this.babylonClient.getTxSearch(height);
            const transactions = txSearchResult?.txs || [];
            
            if (transactions.length === 0) {
                logger.debug(`No transactions found in block ${height} for ${this.network}`);
                return;
            }
            
            logger.debug(`Found ${transactions.length} transactions in block ${height} for ${this.network}`);
            
            for (const tx of transactions) {
                try {
                    // Ensure tx has a hash
                    const txHash = tx.hash || tx.txhash || (tx.tx_response && tx.tx_response.txhash);
                    if (!txHash) {
                        logger.warn(`Transaction without hash found in block ${height}, skipping`);
                        continue;
                    }
                    
                    // Decode the transaction
                    const txBase64 = this.extractTxBase64(tx);
                    if (!txBase64) {
                        logger.warn(`Cannot find base64 transaction data for tx: ${txHash}`);
                        continue;
                    }
                    
                    // Decode the base64 transaction
                    const decodedTx = decodeTx(txBase64);
                    
                    // Get the type of the first message (for msgType)
                    const msgType = this.extractMessageTypeFromDecodedTx(decodedTx);
                    
                    // Parse the transaction
                    const parsedTx = this.transactionParser.parseTransaction(tx, msgType, this.network);
                    
                    // If the transaction was parsed, process it
                    if (parsedTx) {
                        // Process the transaction data
                        await this.processTransaction(parsedTx);
                        
                        // Check if it's a staking transaction and process it accordingly
                        await this.stakingProcessor.processTransactionIfStaking(parsedTx, tx, decodedTx);
                    }
                    
                } catch (error) {
                    logger.error(`Error processing transaction in block ${height}:`, error);
                }
            }
            
            logger.debug(`Completed processing block ${height} for ${this.network}`);
        } catch (error) {
            logger.error(`Error processing block ${height} for ${this.network}:`, error);
            throw error;
        }
    }
    
    /**
     * İşlemden base64 formatındaki tx verisini çıkarır
     */
    private extractTxBase64(tx: any): string | null {
        if (tx.tx && typeof tx.tx === 'string') {
            // tx.tx doğrudan base64 string ise
            return tx.tx;
        } else if (tx.tx_response && tx.tx_response.tx && typeof tx.tx_response.tx === 'string') {
            // tx_response içindeki tx alanı base64 string ise
            return tx.tx_response.tx;
        } else if (tx.tx_response && tx.tx_response.data && typeof tx.tx_response.data === 'string') {
            // tx_response içindeki data alanı base64 string ise
            return tx.tx_response.data;
        }
        return null;
    }
    
    /**
     * Decoded tx'ten mesaj tipini çıkarır
     */
    private extractMessageTypeFromDecodedTx(decodedTx: any): string {
        if (decodedTx && decodedTx.messages && decodedTx.messages.length > 0) {
            return decodedTx.messages[0].typeUrl || "";
        }
        return "";
    }

    /**
     * İşlem verilerini işleyerek veritabanına kaydeder
     */
    public async processTransaction(txData: BBNTransactionData): Promise<void> {
        try {
            // Null kontrolü
            if (!txData) {
                logger.warn(`[BBNTransactionIndexer] Null transaction data received, skipping`);
                return;
            }
            
            logger.info(`[BBNTransactionIndexer] Processing transaction: ${txData.txHash}, type: ${txData.type}, network: ${this.network}`);
            logger.debug(`[BBNTransactionIndexer] Transaction details: sender=${txData.sender}, receiver=${txData.receiver}, amount=${txData.amount}, denom=${txData.denom}`);
            
            // İleri işleme için processTransactionData'ya yönlendir
            await this.processTransactionData(txData);
            
            logger.info(`[BBNTransactionIndexer] Transaction processed successfully: ${txData.txHash}`);
        } catch (error) {
            logger.error(`[BBNTransactionIndexer] Error in processTransaction: ${txData?.txHash || 'unknown'}`, error instanceof Error ? error.stack : error);
            throw error;
        }
    }

    /**
     * Determines transaction type from Cosmos SDK message
     */
    public determineTransactionType(msgType: string): BBNTransactionType {
        // Message type mapping
        const typeMap: Record<string, BBNTransactionType> = {
            // Babylon specific messages
            '/babylon.epoching.v1.MsgWrappedDelegate': BBNTransactionType.STAKE,
            '/babylon.epoching.v1.MsgWrappedUndelegate': BBNTransactionType.UNSTAKE,
            '/babylon.btcstaking.v1.MsgCreateBTCDelegation': BBNTransactionType.STAKE,
            
            // Standard Cosmos SDK messages
            'MsgSend': BBNTransactionType.TRANSFER,
            'transfer': BBNTransactionType.TRANSFER,
            'MsgDelegate': BBNTransactionType.STAKE,
            'delegate': BBNTransactionType.STAKE,
            'MsgUndelegate': BBNTransactionType.UNSTAKE,
            'undelegate': BBNTransactionType.UNSTAKE,
            'MsgWithdrawDelegatorReward': BBNTransactionType.REWARD,
            'withdraw_delegator_reward': BBNTransactionType.REWARD
        };
        
        // Check if message type contains any of the known patterns
        for (const [pattern, txType] of Object.entries(typeMap)) {
            if (msgType.includes(pattern)) {
                return txType;
            }
        }
        
        // Default case
        return BBNTransactionType.OTHER;
    }

    /**
     * Gets transactions from database
     */
    public async getTransactions(
        options: {
            network?: Network,
            address?: string,
            type?: BBNTransactionType,
            startTime?: number,
            endTime?: number,
            page?: number,
            limit?: number
        } = {}
    ): Promise<{
        transactions: any[],
        total: number,
        page: number,
        totalPages: number
    }> {
        try {
            const {
                network = this.network,
                address,
                type,
                startTime,
                endTime,
                page = 1,
                limit = 20
            } = options;

            const query: any = { networkType: network.toLowerCase() };

            // Add filters if provided
            if (address) {
                query.$or = [{ sender: address }, { receiver: address }];
            }
            
            if (type) {
                query.type = type;
            }
            
            if (startTime || endTime) {
                query.timestamp = {};
                if (startTime) query.timestamp.$gte = startTime;
                if (endTime) query.timestamp.$lte = endTime;
            }

            // Get total count for pagination
            const total = await BBNTransaction.countDocuments(query);
            
            // Apply pagination
            const skip = (page - 1) * limit;
            
            // Get transactions
            const transactions = await BBNTransaction.find(query)
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit);

            const totalPages = Math.ceil(total / limit);
            
            return {
                transactions,
                total,
                page,
                totalPages
            };
        } catch (error) {
            logger.error('Error getting transactions:', error);
            throw error;
        }
    }

    /**
     * Processes transaction data and saves it to the database
     * @param txData Transaction data to process
     * @param height Block height (if not already included in txData)
     */
    private async processTransactionData(txData: BBNTransactionData, height?: number): Promise<void> {
        try {
            logger.debug(`Processing transaction data: ${txData.txHash}`);
            
            // Veritabanı modellerini kullanarak kaydetme işlemleri
            const transaction = await BBNTransaction.findOne({ txHash: txData.txHash });
            
            if (transaction) {
                // Transaction zaten var, güncelle
                logger.debug(`Transaction already exists, updating: ${txData.txHash}`);
                await BBNTransaction.findOneAndUpdate(
                    { txHash: txData.txHash },
                    {
                        type: txData.type,
                        status: txData.status,
                        amount: txData.amount,
                        fee: txData.fee,
                        memo: txData.memo,
                        indexedAt: new Date()
                    }
                );
            } else {
                // Yeni transaction oluştur
                logger.debug(`Creating new transaction: ${txData.txHash}`);
                try {
                    await BBNTransaction.create({
                        txHash: txData.txHash,
                        blockHeight: txData.blockHeight,
                        type: txData.type,
                        status: txData.status,
                        sender: txData.sender,
                        receiver: txData.receiver,
                        amount: txData.amount,
                        denom: txData.denom,
                        fee: txData.fee,
                        memo: txData.memo,
                        timestamp: txData.timestamp,
                        networkType: txData.networkType,
                        indexedAt: new Date()
                    });
                } catch (insertError: any) {
                    // MongoDB duplike key hatası kontrolü (E11000 duplicate key error)
                    if (insertError.code === 11000 && insertError.keyPattern?.txHash) {
                        logger.warn(`Duplicate transaction detected, attempting to update instead: ${txData.txHash}`);
                        
                        // Duplike hata durumunda, güncelleme yapmayı deneyelim
                        await BBNTransaction.findOneAndUpdate(
                            { txHash: txData.txHash },
                            {
                                type: txData.type,
                                status: txData.status,
                                amount: txData.amount,
                                fee: txData.fee,
                                memo: txData.memo,
                                indexedAt: new Date()
                            },
                            { upsert: false } // Key zaten var, o yüzden upsert false
                        );
                    } else {
                        // Başka bir hata ise yeniden fırlat
                        throw insertError;
                    }
                }
            }
            
            // İşlem gerçekleştiğini log'a yaz
            logger.debug(`Transaction ${txData.txHash} processed successfully`);
            
            // Cache güncelle
            await this.transactionCache.updateTransactionCache(txData);
            
            // İlgili hesap verilerini güncelle
            if (txData.sender) {
                await this.updateAccountData(txData.sender, txData.blockHeight || height || 0);
            }
            
            if (txData.receiver && txData.receiver !== txData.sender) {
                await this.updateAccountData(txData.receiver, txData.blockHeight || height || 0);
            }
        } catch (error) {
            logger.error(`Error processing transaction data: ${txData.txHash}`, error);
            // Ana hata işleme kısmında hatayı fırlatma - işlemi geçelim ama loglayalım
            // throw error; - bu satırı kaldırdık
        }
    }

    /**
     * Updates account data based on transaction
     * @param address Account address to update
     * @param blockHeight Current block height
     */
    private async updateAccountData(address: string, blockHeight: number): Promise<void> {
        try {
            // Hesabı bul veya oluştur
            await BBNAccount.findOneAndUpdate(
                { address: address, networkType: this.network },
                { 
                    address: address, 
                    networkType: this.network,
                    lastUpdatedHeight: blockHeight,
                    lastUpdatedAt: new Date()
                },
                { upsert: true }
            );
            
            // NOT: Bakiye güncellemesi için daha sonra ayrı bir servis eklenebilir
            // Şu anda API'de doğrudan bakiye sorgulama metodu bulunmuyor
            
        } catch (error) {
            logger.error(`Error updating account data for ${address}:`, error);
        }
    }
} 