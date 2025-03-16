/**
 * Transaction Repository
 * Implements database operations for transactions
 */

import { BaseTx } from '../../types/common';
import { Network } from '../../../../types/finality';
import { BlockchainTransaction, ITransaction } from '../../../../database/models/blockchain/Transaction';
import { ITxRepository } from './ITxRepository';
import { logger } from '../../../../utils/logger';
import { TxMapper } from '../mapper/TxMapper';

export class TxRepository implements ITxRepository {
  private static instance: TxRepository | null = null;
  
  private constructor() {
    // Private constructor to enforce singleton pattern
  }
  
  /**
   * Singleton instance
   */
  public static getInstance(): TxRepository {
    if (!TxRepository.instance) {
      TxRepository.instance = new TxRepository();
    }
    return TxRepository.instance;
  }
  
  /**
   * Format error message consistently
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  
  /**
   * Saves transaction to database
   */
  public async saveTx(tx: BaseTx, network: Network): Promise<void> {
    try {
      // Extract firstMessageType from meta data
      const firstMessageType = TxMapper.extractFirstMessageType(tx);
      
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
    } catch (error) {
      logger.error(`[TxRepository] Error saving transaction to database: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Finds transaction by hash
   */
  public async findTxByHash(txHash: string, network: Network): Promise<ITransaction | null> {
    try {
      return await BlockchainTransaction.findOne({ txHash, network });
    } catch (error) {
      logger.error(`[TxRepository] Error finding transaction by hash: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Finds transactions by height
   */
  public async findTxsByHeight(height: string, network: Network): Promise<ITransaction[]> {
    try {
      return await BlockchainTransaction.find({ height, network });
    } catch (error) {
      logger.error(`[TxRepository] Error finding transactions by height: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Gets total transaction count
   */
  public async getTxCount(network: Network): Promise<number> {
    try {
      return await BlockchainTransaction.countDocuments({ network });
    } catch (error) {
      logger.error(`[TxRepository] Error getting transaction count: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Gets paginated transactions
   */
  public async getPaginatedTransactions(
    network: Network,
    page: number = 1,
    limit: number = 50,
    sortOptions: Record<string, any> = { height: -1, time: -1 }
  ): Promise<{
    transactions: ITransaction[],
    total: number,
    pages: number
  }> {
    try {
      // Ensure page and limit are valid
      page = Math.max(1, page); // Minimum page is 1
      limit = Math.min(100, Math.max(1, limit)); // limit between 1 and 100
      
      // Get total count for pagination
      const total = await this.getTxCount(network);
      
      // Calculate total pages
      const pages = Math.ceil(total / limit);
      
      // Calculate skip value for pagination
      const skip = (page - 1) * limit;
      
      // Get transactions
      const transactions = await BlockchainTransaction.find(
        { network },
        { 
          _id: 0,
          txHash: 1, 
          height: 1, 
          status: 1, 
          type: 1, 
          time: 1, 
          messageCount: 1, 
          firstMessageType: 1 
        }
      )
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean();
      
      return {
        transactions,
        total,
        pages
      };
    } catch (error) {
      logger.error(`[TxRepository] Error getting paginated transactions: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Gets transactions with range-based pagination
   * This is an alternative pagination method that uses a reference point instead of skip/limit
   */
  public async getTransactionsWithRangePagination(
    network: Network,
    limit: number = 50,
    lastItem: any = null
  ): Promise<{
    transactions: ITransaction[],
    total: number,
    pages: number
  }> {
    try {
      // Ensure limit is valid
      limit = Math.min(100, Math.max(1, limit)); // limit between 1 and 100
      
      // Get total count for pagination
      const total = await this.getTxCount(network);
      
      // Calculate total pages
      const pages = Math.ceil(total / limit);
      
      // Prepare query
      let query: any = { network };
      
      // If we have a last item, use it as a reference point
      if (lastItem) {
        query.$or = [
          // First sort by height
          { height: { $lt: lastItem.height } },
          // If same height, sort by time
          { 
            height: lastItem.height,
            time: { $lt: lastItem.time }
          }
        ];
      }
      
      // Get transactions
      const transactions = await BlockchainTransaction.find(
        query,
        { 
          _id: 0,
          txHash: 1, 
          height: 1, 
          status: 1, 
          type: 1, 
          time: 1, 
          messageCount: 1, 
          firstMessageType: 1 
        }
      )
      .sort({ height: -1, time: -1 })
      .limit(limit)
      .lean();
      
      return {
        transactions,
        total,
        pages
      };
    } catch (error) {
      logger.error(`[TxRepository] Error getting transactions with range pagination: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Updates existing transactions with firstMessageType field
   * This is a one-time operation to update existing records
   */
  public async updateTransactionsWithFirstMessageType(
    network: Network,
    batchSize: number = 100
  ): Promise<number> {
    try {
      // Get count of transactions without firstMessageType
      const countToMigrate = await BlockchainTransaction.countDocuments({ 
        network, 
        firstMessageType: { $exists: false } 
      });
      
      if (countToMigrate === 0) {
        logger.info(`[TxRepository] No transactions need migration for ${network}`);
        return 0;
      }
      
      logger.info(`[TxRepository] Found ${countToMigrate} transactions to migrate for ${network}`);
      
      // Process in batches to avoid memory issues
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
        logger.info(`[TxRepository] Migrated ${processed}/${countToMigrate} transactions for ${network}`);
        
        // If we processed less than batchSize, we're done
        if (transactions.length < batchSize) {
          break;
        }
      }
      
      return processed;
    } catch (error) {
      logger.error(`[TxRepository] Error updating transactions with firstMessageType: ${this.formatError(error)}`);
      throw error;
    }
  }
} 