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
import { TransactionStatsService } from '../stats/TransactionStatsService';

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
   * Saves transaction to database and updates statistics
   */
  public async saveTx(tx: BaseTx, network: Network, firstMessageType?: string): Promise<void> {
    try {
      // If firstMessageType is not provided, extract from meta data
      const txFirstMessageType = firstMessageType || TxMapper.extractFirstMessageType(tx);
      
      try {
        // Save to database
        const result = await BlockchainTransaction.findOneAndUpdate(
          {
            txHash: tx.txHash,
            network: network
          },
          {
            ...tx,
            network: network,
            firstMessageType: txFirstMessageType,
            isLite: tx.isLite || false // add isLite field
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
          }
        );
        
        // Check if this was a new transaction (not an update)
        const isNewTransaction = !result || result.isNew;
        
        if (isNewTransaction) {
          // Update transaction stats (don't await to avoid blocking)
          this.updateTransactionStats(network, tx.type, tx.height);
        }
      } catch (dbError: any) {
        // Handle duplicate key errors gracefully
        if (dbError.code === 11000) {  // MongoDB duplicate key error code
          logger.warn(`[TxRepository] Transaction ${tx.txHash} already exists in network ${network}, skipping save operation`);
          return;  // Exit without throwing an error since this is an expected case
        }
        // Re-throw other errors
        throw dbError;
      }
    } catch (error) {
      logger.error(`[TxRepository] Error saving transaction to database: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Updates transaction statistics after saving a new transaction
   * This runs asynchronously to avoid blocking the main operation
   * @private
   */
  private updateTransactionStats(network: Network, txType?: string, height?: string | number): void {
    // Don't await to avoid blocking
    TransactionStatsService.getInstance()
      .incrementCount(network, txType, height)
      .catch(error => {
        logger.warn(`[TxRepository] Failed to update transaction stats: ${this.formatError(error)}`);
      });
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
      return await BlockchainTransaction.find({ height, network })
        .collation({ locale: 'en_US', numericOrdering: true });
    } catch (error) {
      logger.error(`[TxRepository] Error finding transactions by height: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Gets total transaction count
   * Uses pre-computed statistics to avoid expensive count operation
   */
  public async getTxCount(network: Network): Promise<number> {
    try {
      // Use the stats service to get pre-computed count
      const statsService = TransactionStatsService.getInstance();
      const count = await statsService.getTotalCount(network);
      
      // Log the source of the count for debugging
      logger.debug(`[TxRepository] Got transaction count from stats service: ${count}`);
      
      return count;
    } catch (error) {
      logger.error(`[TxRepository] Error getting transaction count: ${this.formatError(error)}`);
      
      // Fall back to direct count only if stats service fails
      logger.warn('[TxRepository] Falling back to direct count due to stats service error');
      try {
        return await BlockchainTransaction.countDocuments({ network });
      } catch (fallbackError) {
        logger.error(`[TxRepository] Fallback count failed: ${this.formatError(fallbackError)}`);
        throw fallbackError;
      }
    }
  }
  
  /**
   * Gets paginated transactions using optimized cursor-based pagination
   */
  public async getPaginatedTransactions(
    network: Network,
    page: number = 1,
    limit: number = 50,
    sortOptions: Record<string, any> = { height: -1, time: -1 },
    cursor: string | null = null
  ): Promise<{
    transactions: ITransaction[],
    total: number,
    pages: number,
    nextCursor: string | null
  }> {
    try {
      // Start timing for performance measurement
      const startTime = process.hrtime();
      
      // Ensure limit is valid
      limit = Math.min(100, Math.max(1, limit));
      
      // Get total count for pagination
      const totalPromise = this.getTxCount(network);
      
      // Prepare query
      let query: any = { network };
      
      // If we have a cursor, decode it and use it as a reference point
      if (cursor) {
        try {
          const decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
          if (decodedCursor.height && decodedCursor.time) {
            // Use $or for proper sorting based on both height and time
            query.$or = [
              { height: { $lt: decodedCursor.height } },
              { 
                height: decodedCursor.height,
                time: { $lt: decodedCursor.time }
              }
            ];
          }
        } catch (error) {
          logger.warn(`[TxRepository] Invalid cursor format: ${cursor}`);
          // If cursor is invalid, proceed without it
        }
      } else if (page > 1) {
        // If a specific page is requested without cursor, we need to use skip/limit
        // This is less efficient but maintains backwards compatibility
        logger.warn(`[TxRepository] Using skip/limit pagination for page ${page} without cursor`);
      }
      
      // Get transactions
      const projection = { 
        _id: 0,
        txHash: 1, 
        height: 1, 
        status: 1, 
        type: 1, 
        time: 1, 
        messageCount: 1, 
        firstMessageType: 1 
      };
      
      let txQuery = BlockchainTransaction.find(query, projection)
        .sort(sortOptions)
        .collation({ locale: 'en_US', numericOrdering: true })
        .limit(limit + 1) // Get one extra to determine if there's a next page
        .lean();
      
      // Only use skip if we absolutely need to (i.e., no cursor but specific page requested)
      if (!cursor && page > 1) {
        const skip = (page - 1) * limit;
        txQuery = txQuery.skip(skip);
      }
      
      // Execute query
      const transactions = await txQuery;
      
      // Determine if we have next page and remove the extra item
      const hasNextPage = transactions.length > limit;
      if (hasNextPage) {
        transactions.pop(); // Remove the extra item
      }
      
      // Create next cursor if we have more pages
      let nextCursor: string | null = null;
      if (hasNextPage && transactions.length > 0) {
        const lastItem = transactions[transactions.length - 1];
        const cursorData = {
          height: lastItem.height,
          time: lastItem.time
        };
        nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
      }
      
      // Get total count (await the promise we started earlier)
      const total = await totalPromise;
      const pages = Math.ceil(total / limit);
      
      // Calculate performance metrics
      const hrend = process.hrtime(startTime);
      const executionTimeMs = hrend[0] * 1000 + hrend[1] / 1000000;
      logger.debug(`[TxRepository] getPaginatedTransactions completed in ${executionTimeMs.toFixed(2)}ms`);
      
      return {
        transactions,
        total,
        pages,
        nextCursor
      };
    } catch (error) {
      logger.error(`[TxRepository] Error getting paginated transactions: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Find transactions using a custom query
   * This is used for bidirectional cursor pagination
   * @param query MongoDB query object
   * @param sortOptions Sort options
   * @param limit Maximum number of documents to return
   * @returns Array of transaction documents
   */
  public async findTransactionsWithQuery(
    query: Record<string, any>,
    sortOptions: any = { height: -1, time: -1 },
    limit: number = 1
  ): Promise<ITransaction[]> {
    try {
      // Ensure limit is valid
      limit = Math.min(100, Math.max(1, limit));
      
      // Standard projection for transactions
      const projection = { 
        _id: 0,
        txHash: 1, 
        height: 1, 
        status: 1, 
        type: 1, 
        time: 1, 
        messageCount: 1, 
        firstMessageType: 1,
        network: 1
      };
      
      // Execute query with sort and limit
      const transactions = await BlockchainTransaction.find(query, projection)
        .sort(sortOptions)
        .collation({ locale: 'en_US', numericOrdering: true })
        .limit(limit)
        .lean();
      
      return transactions;
    } catch (error) {
      logger.error(`[TxRepository] Error in findTransactionsWithQuery: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Gets latest transactions with optimized range-based pagination
   * This function should be used for getting the most recent transactions
   */
  public async getLatestTransactions(
    network: Network,
    limit: number = 50
  ): Promise<{
    transactions: ITransaction[],
    total: number,
    pages: number
  }> {
    try {
      // Start timing for performance measurement
      const startTime = process.hrtime();
      
      // Ensure limit is valid
      limit = Math.min(100, Math.max(1, limit));
      
      // Get total count for pagination
      const totalPromise = this.getTxCount(network);
      
      // Use the network-specific index to get the latest transactions
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
      .sort({ height: -1, time: -1 }) // Sort by height and time descending
      .collation({ locale: 'en_US', numericOrdering: true })
      .limit(limit)
      .lean();
      
      // Get total count (await the promise we started earlier)
      const total = await totalPromise;
      const pages = Math.ceil(total / limit);
      
      // Calculate performance metrics
      const hrend = process.hrtime(startTime);
      const executionTimeMs = hrend[0] * 1000 + hrend[1] / 1000000;
      logger.debug(`[TxRepository] getLatestTransactions completed in ${executionTimeMs.toFixed(2)}ms`);
      
      return {
        transactions,
        total,
        pages
      };
    } catch (error) {
      logger.error(`[TxRepository] Error getting latest transactions: ${this.formatError(error)}`);
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
  
  /**
   * Returns the number of full-content transactions of a specific type created within a certain period
   */
  public async countRecentFullTxsByType(
    messageType: string,
    network: Network,
    hoursAgo: number
  ): Promise<number> {
    try {
      // Calculate the date for a certain number of hours ago from now
      const date = new Date();
      date.setHours(date.getHours() - hoursAgo);
      
      // Count transactions with metadata of a specific type
      return await BlockchainTransaction.countDocuments({
        network,
        'meta.typeUrl': messageType,
        isLite: { $ne: true }, // Not in lite mode
        createdAt: { $gte: date }
      });
    } catch (error) {
      logger.error(`[TxRepository] Error counting recent full txs by type: ${this.formatError(error)}`);
      return 0;
    }
  }
} 