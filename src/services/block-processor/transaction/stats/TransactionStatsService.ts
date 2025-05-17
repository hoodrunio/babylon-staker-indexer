/**
 * Transaction Statistics Service
 * Manages pre-computed statistics for transactions to avoid expensive count operations
 */

import { Network } from '../../../../types/finality';
import { TransactionStats, ITransactionStats } from '../../../../database/models/blockchain/TransactionStats';
import { BlockchainTransaction } from '../../../../database/models/blockchain/Transaction';
import { Block } from '../../../../database/models/blockchain/Block';
import { logger } from '../../../../utils/logger';

/**
 * Service for managing transaction statistics
 */
export class TransactionStatsService {
  private static instance: TransactionStatsService | null = null;
  
  private constructor() {
    // Private constructor to enforce singleton pattern
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): TransactionStatsService {
    if (!TransactionStatsService.instance) {
      TransactionStatsService.instance = new TransactionStatsService();
    }
    return TransactionStatsService.instance;
  }
  
  /**
   * Get transaction statistics for a network
   * @param network Network identifier
   * @returns Transaction statistics or null if not found
   */
  public async getStats(network: Network): Promise<ITransactionStats | null> {
    try {
      return await TransactionStats.findOne({ network });
    } catch (error) {
      logger.error(`[TransactionStatsService] Error getting stats for ${network}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Get total transaction count for a network
   * Uses pre-computed statistic instead of counting documents
   * @param network Network identifier
   * @returns Total transaction count
   */
  public async getTotalCount(network: Network): Promise<number> {
    try {
      const stats = await this.getStats(network);
      if (stats) {
        return stats.totalCount;
      }
      
      // If stats don't exist yet, compute and save them
      await this.updateStats(network);
      const updatedStats = await this.getStats(network);
      return updatedStats?.totalCount || 0;
    } catch (error) {
      logger.error(`[TransactionStatsService] Error getting total count for ${network}: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
  
  /**
   * Update transaction statistics for a network
   * This is an expensive operation and should be called infrequently,
   * ideally in a background job or after processing new blocks
   * @param network Network identifier
   */
  public async updateStats(network: Network): Promise<void> {
    const startTime = Date.now();
    logger.info(`[TransactionStatsService] Starting stats update for ${network}`);
    
    try {
      // Get total transaction count (expensive operation)
      const totalCount = await BlockchainTransaction.countDocuments({ network });
      
      // Get latest transaction height using numeric conversion for reliable sorting
      // First try direct sort (which might not work correctly with string heights)
      const latestTxDirect = await BlockchainTransaction.findOne({ network })
        .sort({ height: -1 })
        .limit(1)
        .lean();
      
      // Then use aggregate with numeric conversion (more reliable)
      const heightAggResult = await BlockchainTransaction.aggregate([
        { $match: { network } },
        { $addFields: { numericHeight: { $convert: { input: "$height", to: "int" } } } },
        { $sort: { numericHeight: -1 } },
        { $limit: 1 }
      ]);
      
      // Compare results
      const directHeight = latestTxDirect?.height;
      const aggregateHeight = heightAggResult.length > 0 ? heightAggResult[0].height : null;
      
      logger.debug(`[TransactionStatsService] Height comparison - Direct query: ${directHeight}, Aggregate: ${aggregateHeight}`);
      
      // Use the aggregate result if it found a higher height
      const finalLatestTx = aggregateHeight && (!directHeight || parseInt(aggregateHeight) > parseInt(directHeight))
        ? heightAggResult[0]
        : latestTxDirect;
      
      const latestHeight = finalLatestTx?.height || 0;
      
      if (directHeight !== aggregateHeight) {
        logger.info(`[TransactionStatsService] Using aggregate height ${aggregateHeight} instead of direct height ${directHeight} for network ${network}`);
      }
      
      // Get transaction counts by type
      const typeCounts = await BlockchainTransaction.aggregate([
        { $match: { network } },
        { $group: { _id: "$type", count: { $sum: 1 } } }
      ]);
      
      // Format type counts as a record
      const countByType: Record<string, number> = {};
      typeCounts.forEach(item => {
        if (item._id) {
          // Sanitize transaction type key by replacing dots with underscores
          // This is needed because Mongoose maps don't support keys with dots
          const sanitizedKey = item._id.replace(/\./g, '_');
          countByType[sanitizedKey] = item.count;
          
          // If the key was sanitized, log it for debugging
          if (sanitizedKey !== item._id) {
            logger.debug(`[TransactionStatsService] Sanitized transaction type key: ${item._id} -> ${sanitizedKey}`);
          }
        }
      });
      
      // Get transaction count for last 24 hours using blocks collection
      // This is more accurate than estimating from block height
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      logger.debug(`[TransactionStatsService] Calculating transactions in the last 24 hours (since ${oneDayAgo.toISOString()})`);
      
      // Find blocks from the last 24 hours
      const blocksLast24Hours = await Block.find({
        network,
        time: { $gte: oneDayAgo }
      }).lean();
      
      // Calculate total transactions using numTxs field
      let last24HourCount = 0;
      
      if (blocksLast24Hours.length > 0) {
        // Sum up numTxs from all blocks in the last 24 hours
        last24HourCount = blocksLast24Hours.reduce((total, block) => {
          return total + (block.numTxs || 0);
        }, 0);
        
        const heightValues = blocksLast24Hours.map(b => parseInt(b.height || '0')).filter(h => !isNaN(h));
        const minHeight = heightValues.length > 0 ? Math.min(...heightValues) : 0;
        const maxHeight = heightValues.length > 0 ? Math.max(...heightValues) : 0;
        
        logger.debug(`[TransactionStatsService] Found ${blocksLast24Hours.length} blocks in last 24 hours from height ${minHeight} to ${maxHeight} with ${last24HourCount} total transactions`);
      } else {
        logger.debug('[TransactionStatsService] No blocks found in the last 24 hours. Using fallback method.');
        
        // Fallback: Use last 10,000 blocks as requested by user
        const latestHeightNum = typeof latestHeight === 'string' ? parseInt(latestHeight, 10) : latestHeight as number;
        const blockRangeStart = Math.max(1, latestHeightNum - 10000);
        
        // Get a count of transactions in the last 10,000 blocks
        const fallbackBlocks = await Block.find({
          network,
          height: { $gte: blockRangeStart.toString() }
        }).lean();
        
        if (fallbackBlocks.length > 0) {
          last24HourCount = fallbackBlocks.reduce((total, block) => {
            return total + (block.numTxs || 0);
          }, 0);
          
          logger.debug(`[TransactionStatsService] Fallback: Found ${fallbackBlocks.length} blocks from height ${blockRangeStart} to ${latestHeight} with ${last24HourCount} total transactions`);
        } else {
          logger.warn(`[TransactionStatsService] No blocks found in the last 10,000 range for network ${network}. Setting 24-hour count to 0.`);
        }
      }
      
      // Update or create stats document
      await TransactionStats.updateOne(
        { network },
        {
          $set: {
            totalCount,
            latestHeight,
            countByType,
            last24HourCount,
            lastUpdated: new Date()
          }
        },
        { upsert: true }
      );
      
      const duration = Date.now() - startTime;
      logger.info(`[TransactionStatsService] Stats updated for ${network} in ${duration}ms: ${totalCount} transactions, latest height ${latestHeight}`);
    } catch (error) {
      logger.error(`[TransactionStatsService] Error updating stats for ${network}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Increment transaction count when a new transaction is saved
   * This provides real-time updates without expensive recounting
   * @param network Network identifier
   * @param txType Transaction type (optional)
   * @param height Block height (optional)
   */
  public async incrementCount(network: Network, txType?: string, height?: number | string): Promise<void> {
    try {
      const updateData: Record<string, any> = {
        $inc: { totalCount: 1 },
        lastUpdated: new Date()
      };
      
      // If a transaction type is provided, increment its count
      if (txType) {
        // Sanitize transaction type key by replacing dots with underscores
        // This is needed because Mongoose maps don't support keys with dots
        const sanitizedTxType = txType.replace(/\./g, '_');
        updateData.$inc[`countByType.${sanitizedTxType}`] = 1;
        
        // Log if we sanitized the key
        if (sanitizedTxType !== txType) {
          logger.debug(`[TransactionStatsService] Sanitized transaction type key for increment: ${txType} -> ${sanitizedTxType}`);
        }
      }
      
      // If height is provided, update latest height if greater than current
      if (height) {
        const heightNum = typeof height === 'string' ? parseInt(height) : height;
        updateData.$max = { latestHeight: heightNum };
      }
      
      // Update the 24-hour count as well
      updateData.$inc.last24HourCount = 1;
      
      await TransactionStats.updateOne(
        { network },
        updateData,
        { upsert: true }
      );
    } catch (error) {
      logger.error(`[TransactionStatsService] Error incrementing count for ${network}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Initialize statistics for all supported networks
   * This should be called during application startup
   * @param networks Array of supported networks
   */
  public async initializeStats(networks: Network[]): Promise<void> {
    try {
      for (const network of networks) {
        const stats = await this.getStats(network);
        if (!stats) {
          logger.info(`[TransactionStatsService] No stats found for ${network}, generating initial stats`);
          await this.updateStats(network);
        } else {
          logger.info(`[TransactionStatsService] Found existing stats for ${network}: ${stats.totalCount} transactions, latest height ${stats.latestHeight}`);
        }
      }
    } catch (error) {
      logger.error(`[TransactionStatsService] Error initializing stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
