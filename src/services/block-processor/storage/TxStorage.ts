/**
 * Transaction Storage Service
 * Stores transaction data in the database
 */

import { BaseTx, TxMessage, TxStatus, SimpleTx, PaginatedTxsResponse } from '../types/common';
import { ITxStorage } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { BlockchainTransaction, ITransaction } from '../../../database/models/blockchain/Transaction';
import { Network } from '../../../types/finality';
import { FetcherService } from '../common/fetcher.service';
import { PipelineStage } from 'mongoose';

/**
 * Service for storing transaction data
 */
export class TxStorage implements ITxStorage {
    private static instance: TxStorage | null = null;
    private fetcherService: FetcherService | null = null;
    // Cache mekanizması için değişkenler
    private transactionCache: Map<string, { data: PaginatedTxsResponse, timestamp: number }> = new Map();
    private readonly CACHE_TTL = 10 * 1000; // 30 saniye cache süresi
    
    private constructor() {
        // Private constructor to enforce singleton pattern
        this.initializeServices();
    }

    /**
     * Initialize required services
     */
    private initializeServices(): void {
        try {
            this.fetcherService = FetcherService.getInstance();
        } catch (error) {
            logger.warn(`[TxStorage] FetcherService initialization failed: ${this.formatError(error)}`);
        }
    }

    /**
     * Format error message consistently
     */
    private formatError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    /**
     * Singleton instance
     */
    public static getInstance(): TxStorage {
        if (!TxStorage.instance) {
            TxStorage.instance = new TxStorage();
        }
        return TxStorage.instance;
    }

    /**
     * Migrates existing transactions to add firstMessageType field
     * This is a one-time operation to update existing records
     */
    public async migrateExistingTransactions(network: Network): Promise<void> {
        try {
            logger.info(`[TxStorage] Starting migration of existing transactions for ${network} to add firstMessageType field`);
            
            // Get count of transactions without firstMessageType
            const countToMigrate = await BlockchainTransaction.countDocuments({ 
                network, 
                firstMessageType: { $exists: false } 
            });
            
            if (countToMigrate === 0) {
                logger.info(`[TxStorage] No transactions need migration for ${network}`);
                return;
            }
            
            logger.info(`[TxStorage] Found ${countToMigrate} transactions to migrate for ${network}`);
            
            // Process in batches to avoid memory issues
            const batchSize = 100;
            let processed = 0;
            
            while (processed < countToMigrate) {
                // Get batch of transactions
                const transactions = await BlockchainTransaction.find({ 
                    network, 
                    firstMessageType: { $exists: false } 
                })
                .limit(batchSize);
                
                // Process each transaction
                for (const tx of transactions) {
                    let firstMessageType = 'unknown';
                    
                    if (tx.meta && tx.meta.length > 0) {
                        const firstMeta = tx.meta[0];
                        if (firstMeta.content) {
                            if (firstMeta.content.msg) {
                                // Try to get first key from msg object
                                const msgKeys = Object.keys(firstMeta.content.msg);
                                if (msgKeys.length > 0) {
                                    firstMessageType = msgKeys[0];
                                }
                            } else if (firstMeta.content['@type']) {
                                // If no msg but has @type, use that
                                firstMessageType = firstMeta.content['@type'];
                            }
                        }
                    }
                    
                    // Update transaction
                    await BlockchainTransaction.updateOne(
                        { _id: tx._id },
                        { $set: { firstMessageType } }
                    );
                }
                
                processed += transactions.length;
                logger.info(`[TxStorage] Migrated ${processed}/${countToMigrate} transactions for ${network}`);
                
                // If we processed less than batchSize, we're done
                if (transactions.length < batchSize) {
                    break;
                }
            }
            
            logger.info(`[TxStorage] Migration completed for ${network}. Migrated ${processed} transactions.`);
        } catch (error) {
            logger.error(`[TxStorage] Error migrating transactions: ${this.formatError(error)}`);
            throw error;
        }
    }

    /**
     * Saves transaction to database
     */
    public async saveTx(tx: BaseTx, network: Network): Promise<void> {
        try {
            // Extract firstMessageType from meta data
            let firstMessageType = 'unknown';
            
            if (tx.meta && tx.meta.length > 0) {
                const firstMeta = tx.meta[0];
                if (firstMeta.content) {
                    if (firstMeta.content.msg) {
                        // Try to get first key from msg object
                        const msgKeys = Object.keys(firstMeta.content.msg);
                        if (msgKeys.length > 0) {
                            firstMessageType = msgKeys[0];
                        }
                    } else if (firstMeta.content['@type']) {
                        // If no msg but has @type, use that
                        firstMessageType = firstMeta.content['@type'];
                    }
                }
            }
            
            // Save to database
            await BlockchainTransaction.findOneAndUpdate(
                {
                    txHash: tx.txHash,
                    network: network
                },
                {
                    ...tx,
                    network: network,
                    firstMessageType: firstMessageType
                },
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true
                }
            );

            //   logger.debug(`[TxStorage] Transaction saved to database: ${tx.txHash} at height ${tx.height}`);
        } catch (error) {
            logger.error(`[TxStorage] Error saving transaction to database: ${this.formatError(error)}`);
            throw error;
        }
    }

    /**
     * Gets transaction by hash from database or blockchain
     * If useRawFormat is true, always fetches from blockchain regardless of database presence
     * If not found in database and fetcherService is available, tries to fetch from blockchain
     * @param txHash Transaction hash
     * @param network Network type
     * @param useRawFormat If true, returns raw transaction data from blockchain
     * @returns Transaction data or null if not found
     */
    public async getTxByHash(txHash: string, network: Network, useRawFormat: boolean = false): Promise<BaseTx | any | null> {
        try {
            // If raw format is requested, always fetch from blockchain
            if (useRawFormat) {
                return await this.fetchRawTxByHash(txHash, network);
            }
            
            // For standard format, first try to get from database
            const tx = await this.findTxInDatabase({ txHash, network });

            if (tx) {
                return this.mapToBaseTx(tx);
            }
            
            // If not found in database, try to fetch from blockchain
            return await this.fetchAndSaveTxByHash(txHash, network);
        } catch (error) {
            logger.error(`[TxStorage] Error getting transaction by hash from database: ${this.formatError(error)}`);
            return null;
        }
    }

    /**
     * Gets all transactions at a specific height from the database or blockchain
     * If useRawFormat is true, always fetches from blockchain regardless of database presence
     * If no transactions found and fetcherService is available, tries to fetch from blockchain
     * @param height Block height
     * @param network Network type
     * @param useRawFormat If true, returns raw transaction data from blockchain
     * @returns Array of transactions
     */
    public async getTxsByHeight(height: string | number, network: Network, useRawFormat: boolean = false): Promise<BaseTx[] | any[]> {
        try {
            // If raw format is requested, always fetch from blockchain
            if (useRawFormat) {
                return await this.fetchRawTxsByHeight(height, network);
            }
            
            // For standard format, first try to get from database
            const heightStr = height.toString();
            const txs = await this.findTxsInDatabase({ height: heightStr, network });
            
            // If transactions found in database, return them
            if (txs.length > 0) {
                return txs.map(tx => this.mapToBlockTx(tx));
            }
            
            // If no transactions found in database, try to fetch from blockchain
            return await this.fetchAndSaveTxsByHeight(height, network);
        } catch (error) {
            logger.error(`[TxStorage] Error getting transactions by height from database: ${this.formatError(error)}`);
            return [];
        }
    }

    /**
     * Gets total transaction count from database
     */
    public async getTxCount(network: Network): Promise<number> {
        try {
            return await BlockchainTransaction.countDocuments({ network });
        } catch (error) {
            logger.error(`[TxStorage] Error getting transaction count from database: ${this.formatError(error)}`);
            return 0;
        }
    }

    /**
     * Find a transaction in the database with the given query
     */
    private async findTxInDatabase(query: Record<string, any>): Promise<ITransaction | null> {
        return BlockchainTransaction.findOne(query);
    }

    /**
     * Find transactions in the database with the given query
     */
    private async findTxsInDatabase(query: Record<string, any>): Promise<ITransaction[]> {
        return BlockchainTransaction.find(query);
    }

    /**
     * Fetch raw transaction by hash from blockchain
     */
    private async fetchRawTxByHash(txHash: string, network: Network): Promise<any | null> {
        if (!this.fetcherService) {
            logger.error(`[TxStorage] Raw format requested but FetcherService is not available`);
            return null;
        }
        
        logger.info(`[TxStorage] Raw format requested for transaction ${txHash}, fetching from blockchain`);
        
        try {
            return await this.fetcherService.fetchTxDetails(txHash, network);
        } catch (error) {
            logger.error(`[TxStorage] Error fetching raw transaction by hash: ${this.formatError(error)}`);
            return null;
        }
    }

    /**
     * Fetch raw transactions by height from blockchain
     */
    private async fetchRawTxsByHeight(height: string | number, network: Network): Promise<any[]> {
        if (!this.fetcherService) {
            logger.error(`[TxStorage] Raw format requested but FetcherService is not available`);
            return [];
        }
        
        logger.info(`[TxStorage] Raw format requested for height ${height}, fetching from blockchain`);
        
        try {
            const rawTxs = await this.fetcherService.fetchTxsByHeight(height, network);
            
            if (rawTxs && rawTxs.length > 0) {
                logger.info(`[TxStorage] Found ${rawTxs.length} raw transactions for height ${height} from blockchain`);
                return rawTxs;
            } else {
                logger.info(`[TxStorage] No raw transactions found for height ${height} from blockchain`);
                return [];
            }
        } catch (error) {
            logger.error(`[TxStorage] Error fetching raw transactions from blockchain: ${this.formatError(error)}`);
            return [];
        }
    }

    /**
     * Fetch transaction by hash from blockchain, convert to BaseTx, save to database, and return
     */
    private async fetchAndSaveTxByHash(txHash: string, network: Network): Promise<BaseTx | any | null> {
        if (!this.fetcherService) {
            return null;
        }
        
        logger.info(`[TxStorage] Transaction ${txHash} not found in storage, fetching from blockchain`);
        
        try {
            const txDetails = await this.fetcherService.fetchTxDetails(txHash, network);
            
            if (!txDetails) {
                return null;
            }
            
            return await this.processAndSaveRawTx(txDetails, network);
        } catch (error) {
            logger.error(`[TxStorage] Error fetching transaction by hash: ${this.formatError(error)}`);
            return null;
        }
    }

    /**
     * Fetch transactions by height from blockchain, convert to BaseTx, save to database, and return
     */
    private async fetchAndSaveTxsByHeight(height: string | number, network: Network): Promise<BaseTx[]> {
        if (!this.fetcherService) {
            return [];
        }
        
        logger.info(`[TxStorage] No transactions found for height ${height} in storage, fetching from blockchain`);
        
        try {
            const rawTxs = await this.fetcherService.fetchTxsByHeight(height, network);
            
            if (!rawTxs || rawTxs.length === 0) {
                logger.info(`[TxStorage] No transactions found for height ${height} from blockchain`);
                return [];
            }
            
            logger.info(`[TxStorage] Found ${rawTxs.length} transactions for height ${height} from blockchain`);
            
            return await this.processAndSaveRawTxs(rawTxs, network);
        } catch (error) {
            logger.error(`[TxStorage] Error fetching transactions by height: ${this.formatError(error)}`);
            return [];
        }
    }

    /**
     * Process raw transaction data, convert to BaseTx, save to database, and return
     */
    private async processAndSaveRawTx(txDetails: any, network: Network): Promise<BaseTx | any> {
        try {
            const baseTx = this.convertRawTxToBaseTx(txDetails);
            await this.saveTx(baseTx, network);
            return baseTx;
        } catch (error) {
            logger.error(`[TxStorage] Error processing raw transaction: ${this.formatError(error)}`);
            // Return raw data as fallback
            return txDetails;
        }
    }

    /**
     * Process raw transactions data, convert to BaseTx, save to database, and return
     */
    private async processAndSaveRawTxs(rawTxs: any[], network: Network): Promise<BaseTx[]> {
        try {
            // Check if the response is in tx_search format (has tx_result property)
            if (Array.isArray(rawTxs) && rawTxs[0]?.hash && rawTxs[0]?.tx_result) {
                logger.debug(`[TxStorage] Converting tx_search format transactions`);
                
                // Use Promise.all to handle async map
                const baseTxs = await Promise.all(
                    rawTxs.map(async tx => {
                        // Add network information to the raw tx for use in convertTxSearchResultToBaseTx
                        tx.network = network;
                        return await this.convertTxSearchResultToBaseTx(tx, network);
                    })
                );
                
                // Save all transactions to database
                for (const tx of baseTxs) {
                    await this.saveTx(tx, network);
                }
                
                return baseTxs;
            } else {
                logger.debug(`[TxStorage] Converting standard format transactions`);
                const baseTxs = rawTxs.map(tx => this.convertRawTxToBaseTx(tx));
                
                // Save all transactions to database
                for (const tx of baseTxs) {
                    await this.saveTx(tx, network);
                }
                
                return baseTxs;
            }
        } catch (error) {
            logger.error(`[TxStorage] Error processing raw transactions: ${this.formatError(error)}`);
            return [];
        }
    }

    /**
     * Maps ITransaction model to BaseTx
     */
    private mapToBaseTx(tx: ITransaction): BaseTx {
        const baseTx: BaseTx = {
            txHash: tx.txHash,
            height: tx.height,
            status: tx.status as TxStatus,
            fee: tx.fee,
            messageCount: tx.messageCount,
            type: tx.type,
            time: tx.time,
            meta: tx.meta as TxMessage[]
        };
        
        // Add reason for failed transactions
        if (tx.status === TxStatus.FAILED && tx.reason) {
            baseTx.reason = tx.reason;
        }
        
        return baseTx;
    }

    /**
     * Maps ITransaction model to BaseTx for block view (without meta data)
     */
    private mapToBlockTx(tx: ITransaction): BaseTx {
        const baseTx: BaseTx = {
            txHash: tx.txHash,
            height: tx.height,
            status: tx.status as TxStatus,
            fee: tx.fee,
            messageCount: tx.messageCount,
            type: tx.type,
            time: tx.time,
        //  meta: tx.meta as TxMessage[]
        };
        
        // Add reason for failed transactions
        if (tx.status === TxStatus.FAILED && tx.reason) {
            baseTx.reason = tx.reason;
        }
        
        return baseTx;
    }

    /**
     * Converts raw transaction data from blockchain to BaseTx format
     * This is a simplified implementation and may need to be adjusted based on actual data structure
     */
    private convertRawTxToBaseTx(rawTx: any): BaseTx {
        try {
            // Extract basic information
            const txHash = rawTx.tx_response.txhash || '';
            const height = rawTx.tx_response.height?.toString() || '0';
            
            // Determine status
            const status = rawTx.tx_response.code === 0
                ? TxStatus.SUCCESS
                : TxStatus.FAILED;
            
            // Extract fee information
            const fee = {
                amount: rawTx.tx?.auth_info?.fee?.amount?.[0] ? [{
                    denom: rawTx.tx.auth_info.fee.amount[0].denom || '',
                    amount: rawTx.tx.auth_info.fee.amount[0].amount || '0'
                }] : [],
                gasLimit: rawTx.tx?.auth_info?.fee?.gas_limit?.toString() || '0'
            };
            
            // Extract message information
            const messages = rawTx.tx?.body?.messages || [];
            const messageCount = messages.length;
            
            // Determine main message type
            const type = messageCount > 0 ? messages[0]['@type'] || 'unknown' : 'unknown';
            
            // Create meta information
            const meta: TxMessage[] = messages.map((msg: any) => ({
                typeUrl: msg['@type'] || 'unknown',
                content: msg
            }));
            
            // Use timestamp if available, otherwise current time
            const time = rawTx.timestamp || new Date().toISOString();
            
            // Create base transaction object
            const baseTx: BaseTx = {
                txHash,
                height,
                status,
                fee,
                messageCount,
                type,
                time,
                meta
            };
            
            // Add reason for failed transactions
            if (status === TxStatus.FAILED && rawTx.tx_response.raw_log) {
                baseTx.reason = rawTx.tx_response.raw_log;
            }
            
            return baseTx;
        } catch (error) {
            logger.error(`[TxStorage] Error converting raw tx to BaseTx: ${this.formatError(error)}`);
            throw new Error(`Failed to convert raw transaction: ${this.formatError(error)}`);
        }
    }

    /**
     * Converts tx_search result format to BaseTx format
     * This is specifically for transactions fetched via BlockClient.getTxSearch
     * Returns only basic transaction information: txhash, time, height, status, fee, message count and message type
     */
    private async convertTxSearchResultToBaseTx(rawTx: any, network: Network): Promise<BaseTx> {
        try {
            if (!rawTx) {
                throw new Error('Invalid transaction: rawTx is null or undefined');
            }
            
            if (!rawTx.hash) {
                throw new Error('Invalid transaction format: missing hash');
            }

            // Extract basic information
            const txHash = rawTx.hash || '';
            const height = rawTx.height?.toString() || '0';
            
            // Determine status from tx_result.code
            const status = rawTx.tx_result?.code === 0
                ? TxStatus.SUCCESS
                : TxStatus.FAILED;
            
            // Extract fee information from events
            const feeInfo = this.extractFeeFromEvents(rawTx);
            
            // Extract message type and count from events
            const { messageType, messageCount } = this.extractMessageInfoFromEvents(rawTx, txHash);
            
            // Create minimal meta information - just empty array as we don't need details
            const meta: TxMessage[] = [];
            
            // Get time from the block at this height instead of using current time
            let time = new Date().toISOString(); // Default fallback
            
            if (this.fetcherService && height !== '0') {
                try {
                    // Initialize fetcherService if not already initialized
                    if (!this.fetcherService) {
                        this.initializeServices();
                    }
                    
                    // Fetch block data to get the actual timestamp
                    const blockData = await this.fetcherService.fetchBlockByHeight(height, network);
                    
                    if (blockData && blockData.result && blockData.result.block && blockData.result.block.header && blockData.result.block.header.time) {
                        time = blockData.result.block.header.time;
                    } else {
                        logger.warn(`[TxStorage] Could not extract time from block at height ${height}, using current time as fallback`);
                    }
                } catch (blockError) {
                    logger.error(`[TxStorage] Error fetching block for timestamp at height ${height}: ${this.formatError(blockError)}`);
                    // Continue with default time
                }
            }
            
            // Create base transaction object
            const baseTx: BaseTx = {
                txHash,
                height,
                status,
                fee: feeInfo,
                messageCount: Math.max(1, messageCount), // At least 1 message
                type: messageType,
                time,
                meta // Empty array for minimal response
            };
            
            // Add reason for failed transactions
            if (status === TxStatus.FAILED && rawTx.tx_result?.log) {
                baseTx.reason = rawTx.tx_result.log;
            }
            
            return baseTx;
        } catch (error) {
            logger.error(`[TxStorage] Error converting tx_search result to BaseTx: ${this.formatError(error)}`);
            throw new Error(`Failed to convert tx_search result: ${this.formatError(error)}`);
        }
    }

    /**
     * Extract fee information from transaction events
     */
    private extractFeeFromEvents(rawTx: any): { amount: { denom: string, amount: string }[], gasLimit: string } {
        let feeAmount = '0';
        let feeDenom = 'ubbn';
        let gasWanted = '0';
        
        // Try to find fee information in events
        if (rawTx.tx_result?.events) {
            for (const event of rawTx.tx_result.events) {
                if (event.type === 'tx' && event.attributes) {
                    for (const attr of event.attributes) {
                        if (attr.key === 'fee') {
                            // Fee format is typically "10869ubbn"
                            const feeValue = attr.value || '';
                            const match = feeValue.match(/(\d+)(\D+)/);
                            if (match) {
                                feeAmount = match[1];
                                feeDenom = match[2];
                            }
                            break;
                        }
                    }
                }
            }
        }
        
        // Get gas_wanted from tx_result if available
        if (rawTx.tx_result?.gas_wanted) {
            gasWanted = rawTx.tx_result.gas_wanted.toString();
        }
        
        return {
            amount: [{
                denom: feeDenom,
                amount: feeAmount
            }],
            gasLimit: gasWanted
        };
    }

    /**
     * Extract message type and count from transaction events
     */
    private extractMessageInfoFromEvents(rawTx: any, txHash: string): { messageType: string, messageCount: number } {
        let messageType = 'unknown';
        let messageCount = 0;
        let messageEvents = [];
        
        // First, collect all message events
        if (rawTx.tx_result?.events) {
            messageEvents = rawTx.tx_result.events.filter((event: any) => 
                event.type === 'message' && 
                event.attributes && 
                event.attributes.some((attr: any) => attr.key === 'action')
            );
        }
        
        // Then process them
        if (messageEvents.length > 0) {
            messageCount = messageEvents.length;
            
            // Get the first message event with an action attribute
            const firstMessageEvent = messageEvents[0];
            const actionAttr = firstMessageEvent.attributes.find((attr: { key: string, value: string }) => attr.key === 'action');
            
            if (actionAttr && actionAttr.value) {
                messageType = actionAttr.value;
            }
        } else {
            logger.warn(`[TxStorage] No message events with action found for tx ${txHash}`);
        }
        
        return { messageType, messageCount };
    }

    /**
     * Gets latest transactions with pagination
     * @param network Network type
     * @param page Page number (1-based, default: 1)
     * @param limit Number of transactions per page (default: 50)
     * @returns Paginated transactions response
     */
    public async getLatestTransactions(
        network: Network,
        page: number = 1,
        limit: number = 50
    ): Promise<PaginatedTxsResponse> {
        try {
            // Ensure page and limit are valid
            page = Math.max(1, page); // Minimum page is 1
            limit = Math.min(100, Math.max(1, limit)); // limit between 1 and 100
            
            // Cache key oluştur
            const cacheKey = `${network}-${page}-${limit}`;
            
            // Cache'den kontrol et
            const cachedData = this.transactionCache.get(cacheKey);
            const now = Date.now();
            
            // Eğer cache'de varsa ve süresi geçmediyse, cache'den döndür
            if (cachedData && (now - cachedData.timestamp) < this.CACHE_TTL) {
                logger.debug(`[TxStorage] Returning cached latest transactions for ${network}, page ${page}, limit ${limit}`);
                return cachedData.data;
            }
            
            // İşlem başlangıç zamanı
            const startTime = Date.now();
            
            // Calculate skip value for pagination
            const skip = (page - 1) * limit;
            
            // MongoDB aggregation pipeline kullanarak tek sorguda hem toplam sayıyı hem de işlemleri al
            // PipelineStage tipini kullanarak doğru tip tanımlaması yapıyoruz
            const pipeline: PipelineStage[] = [
                // Sadece belirli ağdaki işlemleri filtrele
                { $match: { network } },
                
                // Facet kullanarak tek sorguda hem toplam sayıyı hem de işlemleri al
                { 
                    $facet: {
                        // Toplam sayıyı hesapla
                        totalCount: [
                            { $count: 'count' }
                        ],
                        
                        // İşlemleri getir
                        transactions: [
                            // Yükseklik ve zamana göre azalan sırada sırala
                            { $sort: { height: -1, time: -1 } },
                            
                            // Sayfalama için atla
                            { $skip: skip },
                            
                            // Sayfalama için sınırla
                            { $limit: limit },
                            
                            // Sadece gerekli alanları seç
                            { 
                                $project: {
                                    _id: 0,
                                    txHash: 1,
                                    height: 1,
                                    status: 1,
                                    type: 1,
                                    time: 1,
                                    messageCount: 1,
                                    firstMessageType: 1
                                } 
                            }
                        ]
                    }
                }
            ];
            
            // Pipeline'ı çalıştır
            const results = await BlockchainTransaction.aggregate(pipeline);
            const result = results[0];
            
            // Toplam sayıyı al (boş dizi olabilir)
            const total = result.totalCount.length > 0 ? result.totalCount[0].count : 0;
            
            // Toplam sayfa sayısını hesapla
            const pages = Math.ceil(total / limit);
            
            // İşlemleri SimpleTx tipine dönüştür
            const simpleTxs: SimpleTx[] = result.transactions.map((tx: any) => ({
                txHash: tx.txHash,
                height: tx.height,
                status: tx.status as TxStatus,
                type: tx.type,
                firstMessageType: tx.firstMessageType || 'unknown',
                time: tx.time,
                messageCount: tx.messageCount
            }));
            
            // İşlem süresi
            const processingTime = Date.now() - startTime;
            logger.debug(`[TxStorage] getLatestTransactions pipeline completed in ${processingTime}ms`);
            
            const paginatedResponse = {
                transactions: simpleTxs,
                pagination: {
                    total,
                    page,
                    limit,
                    pages
                }
            };
            
            // Sonucu cache'e kaydet
            this.transactionCache.set(cacheKey, { data: paginatedResponse, timestamp: now });
            
            return paginatedResponse;
        } catch (error) {
            logger.error(`[TxStorage] Error getting latest transactions: ${this.formatError(error)}`);
            throw error;
        }
    }
}