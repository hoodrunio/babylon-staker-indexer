/**
 * Transaction Storage Service
 * Stores transaction data in the database
 */

import { BaseTx, TxMessage, TxStatus } from '../types/common';
import { ITxStorage } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { BlockchainTransaction, ITransaction } from '../../../database/models/blockchain/Transaction';
import { Network } from '../../../types/finality';
import { FetcherService } from '../common/fetcher.service';

/**
 * Service for storing transaction data
 */
export class TxStorage implements ITxStorage {
    private static instance: TxStorage | null = null;
    private fetcherService: FetcherService | null = null;
    
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
     * Saves transaction to database
     */
    public async saveTx(tx: BaseTx, network: Network): Promise<void> {
        try {
            // Save to database
            await BlockchainTransaction.findOneAndUpdate(
                {
                    txHash: tx.txHash,
                    network: network
                },
                {
                    ...tx,
                    network: network
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
                const baseTxs = rawTxs.map(tx => this.convertTxSearchResultToBaseTx(tx));
                
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
        return {
            txHash: tx.txHash,
            height: tx.height,
            status: tx.status as TxStatus,
            fee: tx.fee,
            messageCount: tx.messageCount,
            type: tx.type,
            time: tx.time,
            meta: tx.meta as TxMessage[]
        };
    }

    /**
     * Maps ITransaction model to BaseTx for block view (without meta data)
     */
    private mapToBlockTx(tx: ITransaction): BaseTx {
        return {
            txHash: tx.txHash,
            height: tx.height,
            status: tx.status as TxStatus,
            fee: tx.fee,
            messageCount: tx.messageCount,
            type: tx.type,
            time: tx.time,
        //  meta: tx.meta as TxMessage[]
        };
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
            
            return {
                txHash,
                height,
                status,
                fee,
                messageCount,
                type,
                time,
                meta
            };
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
    private convertTxSearchResultToBaseTx(rawTx: any): BaseTx {
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
            
            // Use current time as we don't have timestamp in tx_search results
            const time = new Date().toISOString();
            
            return {
                txHash,
                height,
                status,
                fee: feeInfo,
                messageCount: Math.max(1, messageCount), // At least 1 message
                type: messageType,
                time,
                meta // Empty array for minimal response
            };
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
}