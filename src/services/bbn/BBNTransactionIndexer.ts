import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { BBNTransaction, BBNAccount } from '../../database/models';
import { 
    BBNTransactionType, 
    BBNTransactionData
} from '../../types/bbn';
import { logger } from '../../utils/logger';
import { CacheService } from '../CacheService';
import { WebsocketService } from '../WebsocketService';
import { BBNTransactionParser } from './BBNTransactionParser';

export class BBNTransactionIndexer {
    private static instance: BBNTransactionIndexer | null = null;
    private babylonClient: BabylonClient;
    private cacheService: CacheService;
    private isRunning: boolean = false;
    private currentHeight: number = 0;
    private readonly network: Network;
    
    private constructor(network: Network = Network.MAINNET) {
        this.network = network;
        this.babylonClient = BabylonClient.getInstance(network);
        this.cacheService = CacheService.getInstance();
    }

    public static getInstance(network: Network = Network.MAINNET): BBNTransactionIndexer {
        if (!BBNTransactionIndexer.instance) {
            BBNTransactionIndexer.instance = new BBNTransactionIndexer(network);
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
            // Get the current blockchain height
            this.currentHeight = await this.babylonClient.getCurrentHeight();
            logger.info(`Current blockchain height: ${this.currentHeight}`);
            
            // Setup listeners for new transactions
            await this.setupWebsocketListeners();

            // Sync historical data
            await this.syncHistoricalData();
        } catch (error) {
            logger.error('Error starting BBNTransactionIndexer:', error);
            this.isRunning = false;
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
            
            // Cancel any pending tasks
            // Clear any intervals that might have been set
            
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
            const transactionParser = BBNTransactionParser.getInstance();
            
            websocketService.subscribeToTx(
                `bbn_tx_indexer_${this.network}_all`,
                this.network,
                {
                    'message.module': 'bank,staking' // Covers both transfer and staking operations
                },
                async (data: any) => {
                    try {
                        logger.debug(`Received transaction from websocket`);
                        
                        // Websocket verisi doğrudan işlenebilir
                        if (data && data.result && data.result.data && data.result.data.value && data.result.data.value.TxResult) {
                            // Mesaj tipini belirle
                            let msgType = '';
                            if (data.result.events && data.result.events['message.action'] && data.result.events['message.action'][0]) {
                                msgType = data.result.events['message.action'][0];
                            }
                            
                            // Transaction'ı doğrudan parse et
                            const parsedTx = transactionParser.parseTransaction(data, msgType, this.network);
                            if (parsedTx) {
                                await this.processTransaction(parsedTx);
                                return;
                            }
                        }
                        
                        // Eğer doğrudan işlenemezse, hash'i alıp RPC üzerinden detayları getir
                        const txHash = data.TxHash || 
                                      (data.result && data.result.events && data.result.events['tx.hash'] && data.result.events['tx.hash'][0]) || 
                                      data.txhash || 
                                      data.hash;
                                      
                        if (!txHash) {
                            logger.warn(`Received transaction without hash, skipping`);
                            return;
                        }
                        
                        const fullTx = await this.babylonClient.getTransaction(txHash);
                        if (!fullTx) {
                            logger.warn(`Transaction not found: ${txHash}`);
                            return;
                        }
                        
                        // Determine message type
                        let msgType = '';
                        if (fullTx.tx && fullTx.tx.body && fullTx.tx.body.messages && fullTx.tx.body.messages.length > 0) {
                            msgType = fullTx.tx.body.messages[0]['@type'] || '';
                        } else if (fullTx.tx_response && fullTx.tx_response.tx && fullTx.tx_response.tx.body && 
                                  fullTx.tx_response.tx.body.messages && fullTx.tx_response.tx.body.messages.length > 0) {
                            msgType = fullTx.tx_response.tx.body.messages[0]['@type'] || '';
                        }
                        
                        const parsedTx = transactionParser.parseTransaction(fullTx, msgType, this.network);
                        if (parsedTx) {
                            await this.processTransaction(parsedTx);
                        }
                    } catch (error) {
                        let txHash = 'unknown';
                        if (data.TxHash || data.txhash || data.hash) {
                            txHash = data.TxHash || data.txhash || data.hash;
                        } else if (data.result && data.result.events && data.result.events['tx.hash']) {
                            txHash = data.result.events['tx.hash'][0];
                        }
                        
                        if (error instanceof Error && error.message === 'Transaction hash is required') {
                            logger.warn(`Invalid transaction data for ${txHash}: Missing hash`);
                        } else {
                            logger.error(`Error processing transaction from websocket: ${txHash}`, error);
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
            
            const transactionParser = BBNTransactionParser.getInstance();
            
            for (const tx of transactions) {
                try {
                    // Ensure tx has a hash
                    const txHash = tx.hash || tx.txhash || (tx.tx_response && tx.tx_response.txhash);
                    if (!txHash) {
                        logger.warn(`Transaction without hash found in block ${height}, skipping`);
                        continue;
                    }
                    
                    const fullTx = await this.babylonClient.getTransaction(txHash);
                    
                    if (!fullTx) {
                        logger.warn(`Transaction not found: ${txHash}`);
                        continue;
                    }
                    
                    // Determine message type
                    let msgType = '';
                    if (fullTx.tx && fullTx.tx.body && fullTx.tx.body.messages && fullTx.tx.body.messages.length > 0) {
                        msgType = fullTx.tx.body.messages[0]['@type'] || '';
                    } else if (fullTx.tx_response && fullTx.tx_response.tx && fullTx.tx_response.tx.body && 
                              fullTx.tx_response.tx.body.messages && fullTx.tx_response.tx.body.messages.length > 0) {
                        msgType = fullTx.tx_response.tx.body.messages[0]['@type'] || '';
                    }
                    
                    const parsedTx = transactionParser.parseTransaction(fullTx, msgType, this.network);
                    
                    if (parsedTx) {
                        await this.processTransaction(parsedTx);
                    }
                } catch (error) {
                    const txHash = tx.hash || tx.txhash || (tx.tx_response && tx.tx_response.txhash) || 'unknown';
                    if (error instanceof Error && error.message === 'Transaction hash is required') {
                        logger.error(`Error parsing transaction ${txHash}: Transaction hash is required`, error);
                    } else {
                        logger.error(`Error processing transaction ${txHash}:`, error);
                    }
                }
            }
        } catch (error) {
            logger.error(`Error processing block ${height}:`, error);
            throw error;
        }
    }

    /**
     * Processes a transaction and saves it to the database
     */
    public async processTransaction(txData: BBNTransactionData): Promise<void> {
        try {
            // Create or update BBNTransaction
            const transaction = new BBNTransaction(txData);
            await transaction.save();

            // Update BBNAccount for both sender and receiver if they don't exist
            if (txData.sender !== 'unknown') {
                await BBNAccount.findOneAndUpdate(
                    { address: txData.sender, networkType: this.network },
                    { address: txData.sender, networkType: this.network },
                    { upsert: true }
                );
            }

            if (txData.receiver !== 'unknown') {
                await BBNAccount.findOneAndUpdate(
                    { address: txData.receiver, networkType: this.network },
                    { address: txData.receiver, networkType: this.network },
                    { upsert: true }
                );
            }
        } catch (error) {
            logger.error(`Error processing transaction ${txData.txHash}:`, error);
            throw error;
        }
    }

    /**
     * Determines transaction type from Cosmos SDK message
     */
    public determineTransactionType(msgType: string): BBNTransactionType {
        if (msgType.includes('MsgSend') || msgType.includes('transfer')) {
            return BBNTransactionType.TRANSFER;
        } else if (msgType.includes('MsgDelegate') || msgType.includes('delegate')) {
            return BBNTransactionType.STAKE;
        } else if (msgType.includes('MsgUndelegate') || msgType.includes('undelegate')) {
            return BBNTransactionType.UNSTAKE;
        } else if (msgType.includes('MsgWithdrawDelegatorReward') || msgType.includes('withdraw_delegator_reward')) {
            return BBNTransactionType.REWARD;
        } else {
            return BBNTransactionType.OTHER;
        }
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
} 