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
import { TransactionProcessorService } from '../common/transactionProcessor.service';

/**
 * Service for storing transaction data
 */
export class TxStorage implements ITxStorage {
    private static instance: TxStorage | null = null;
    private fetcherService: FetcherService | null = null;
    
    private constructor() {
        // Private constructor to enforce singleton pattern
        try {
            this.fetcherService = FetcherService.getInstance();
        } catch (error) {
            logger.warn(`[TxStorage] FetcherService initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
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
            logger.error(`[TxStorage] Error saving transaction to database: ${error instanceof Error ? error.message : String(error)}`);
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
                if (!this.fetcherService) {
                    logger.error(`[TxStorage] Raw format requested but FetcherService is not available`);
                    return null;
                }
                
                logger.info(`[TxStorage] Raw format requested for transaction ${txHash}, fetching from blockchain`);
                const txDetails = await this.fetcherService.fetchTxDetails(txHash, network);
                
                if (!txDetails) {
                    return null;
                }
                
                return txDetails;
            }
            
            // For standard format, first try to get from database
            const tx = await BlockchainTransaction.findOne({ txHash, network });

            if (tx) {
                return this.mapToBaseTx(tx);
            }
            
            // If not found in database and fetcherService is available, try to fetch from blockchain
            if (this.fetcherService) {
                logger.info(`[TxStorage] Transaction ${txHash} not found in storage, fetching from blockchain`);
                const txDetails = await this.fetcherService.fetchTxDetails(txHash, network);
                
                if (!txDetails) {
                    return null;
                }
                
                // Convert to BaseTx format and save to database
                try {
                    const baseTx = this.convertRawTxToBaseTx(txDetails);
                    await this.saveTx(baseTx, network);
                    return baseTx;
                } catch (error) {
                    logger.error(`[TxStorage] Error converting raw tx to BaseTx: ${error instanceof Error ? error.message : String(error)}`);
                    // Return raw data as fallback
                    return txDetails;
                }
            }
            
            return null;
        } catch (error) {
            logger.error(`[TxStorage] Error getting transaction by hash from database: ${error instanceof Error ? error.message : String(error)}`);
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
                if (!this.fetcherService) {
                    logger.error(`[TxStorage] Raw format requested but FetcherService is not available`);
                    return [];
                }
                
                logger.info(`[TxStorage] Raw format requested for height ${height}, fetching from blockchain`);
                
                // This requires implementation in FetcherService to get transactions by height
                // For now, we'll return an empty array
                // TODO: Implement fetchTxsByHeight in FetcherService
                
                return [];
            }
            
            // For standard format, first try to get from database
            const heightStr = height.toString();
            const txs = await BlockchainTransaction.find({ height: heightStr, network });
            
            // If transactions found in database, return them
            if (txs.length > 0) {
                return txs.map(tx => this.mapToBaseTx(tx));
            }
            
            // If no transactions found in database and fetcherService is available, try to fetch from blockchain
            if (this.fetcherService) {
                logger.info(`[TxStorage] No transactions found for height ${height} in storage, fetching from blockchain`);
                
                // This requires implementation in FetcherService to get transactions by height
                // For now, we'll return an empty array
                // TODO: Implement fetchTxsByHeight in FetcherService
                
                return [];
            }
            
            return [];
        } catch (error) {
            logger.error(`[TxStorage] Error getting transactions by height from database: ${error instanceof Error ? error.message : String(error)}`);
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
            logger.error(`[TxStorage] Error getting transaction count from database: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
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
     * Converts raw transaction data from blockchain to BaseTx format
     * This is a simplified implementation and may need to be adjusted based on actual data structure
     */
    private convertRawTxToBaseTx(rawTx: any): BaseTx {
        try {
            // Extract basic information
            const txHash = rawTx.hash || rawTx.txhash || '';
            const height = rawTx.height?.toString() || '0';
            
            // Determine status
            const status = rawTx.code === 0 || rawTx.code === undefined 
                ? TxStatus.SUCCESS 
                : TxStatus.FAILED;
            
            // Extract fee information
            const fee = {
                amount: rawTx.tx?.auth_info?.fee?.amount || [],
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
            logger.error(`[TxStorage] Error converting raw tx to BaseTx: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error(`Failed to convert raw transaction: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}