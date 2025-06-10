import { Staker } from '../models/Staker';
import { Transaction } from '../models/Transaction';
import { StakerStats, TimeRange, TransactionInfo, GlobalStakerStats } from '../../types';
import { PipelineStage } from 'mongoose';
import { CacheService } from '../../services/CacheService';
import { logger } from '../../utils/logger';

export class StakerService {
  private cache: CacheService;
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CACHE_PREFIX = 'staker';

  constructor() {
    this.cache = CacheService.getInstance();
  }

  private generateCacheKey(method: string, params: Record<string, any>): string {
    return this.cache.generateKey(`${this.CACHE_PREFIX}:${method}`, params);
  }

  async getStakerStats(
    address: string, 
    timeRange?: TimeRange,
    includeTransactions: boolean = false,
    skip: number = 0,
    limit: number = 50,
    sortBy: string = 'totalStake',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<StakerStats> {
    const cacheKey = this.generateCacheKey('stats', {
      address,
      timeRange,
      includeTransactions,
      skip,
      limit,
      sortBy,
      sortOrder
    });

    // Try to get from cache
    const cachedData = await this.cache.get<StakerStats>(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const matchStage: PipelineStage.Match = {
      $match: { stakerAddress: address }
    };

    if (timeRange) {
      matchStage.$match.timestamp = {
        $gte: timeRange.firstTimestamp,
        $lte: timeRange.lastTimestamp
      };
    }

    const pipeline: PipelineStage[] = [
      matchStage,
      {
        $facet: {
          stats: [
            {
              $group: {
                _id: '$stakerAddress',
                totalStake: { $sum: '$stakeAmount' },
                transactionCount: { $sum: 1 },
                uniqueProviders: { $addToSet: '$finalityProvider' },
                uniqueBlocks: { $addToSet: '$blockHeight' },
                firstSeen: { $min: '$timestamp' },
                lastSeen: { $max: '$timestamp' },
                versionsUsed: { $addToSet: '$version' }
              }
            }
          ],
          transactions: [
            { 
              $sort: { 
                [sortBy === 'totalStake' ? 'stakeAmount' : sortBy]: sortOrder === 'asc' ? 1 : -1 
              } 
            },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                txid: 1,
                timestamp: 1,
                amount: '$stakeAmount',
                amountBTC: { $divide: ['$stakeAmount', 100000000] },
                finalityProvider: 1
              }
            }
          ]
        }
      }
    ];

    const [result] = await Transaction.aggregate(pipeline);
    const stats = result.stats[0];

    if (!stats) {
      throw new Error(`Staker not found: ${address}`);
    }

    const staker = await Staker.findOne({ address }).lean();
    if (!staker) {
      throw new Error(`Staker document not found: ${address}`);
    }

    const response = {
      address: staker.address,
      stakerPublicKey: staker.stakerPublicKey,
      totalStake: stats.totalStake.toString(),
      totalStakeBTC: stats.totalStake / 100000000,
      transactionCount: stats.transactionCount,
      uniqueProviders: stats.uniqueProviders.length,
      uniqueBlocks: stats.uniqueBlocks.length,
      timeRange: {
        firstTimestamp: stats.firstSeen,
        lastTimestamp: stats.lastSeen,
        durationSeconds: stats.lastSeen - stats.firstSeen
      },
      averageStakeBTC: (stats.totalStake / stats.transactionCount) / 100000000,
      versionsUsed: stats.versionsUsed,
      finalityProviders: stats.uniqueProviders,
      activeStakes: staker.activeStakes,
      stats: {},
      phaseStakes: staker.phaseStakes?.map(phase => ({
        phase: phase.phase,
        totalStake: phase.totalStake,
        transactionCount: phase.transactionCount,
        finalityProviders: phase.finalityProviders
      })) || [],
      ...(includeTransactions && { transactions: result.transactions })
    };

    // Save to cache
    await this.cache.set(cacheKey, response, this.CACHE_TTL);

    return response;
  }

  async getTopStakers(
    skip: number = 0,
    limit: number = 10,
    sortBy: string = 'totalStake',
    order: 'asc' | 'desc' = 'desc',
    includeTransactions: boolean = false,
    transactionsSkip: number = 0,
    transactionsLimit: number = 50
  ): Promise<StakerStats[]> {
    const cacheKey = this.generateCacheKey('top', {
      skip,
      limit,
      sortBy,
      order,
      includeTransactions,
      transactionsSkip,
      transactionsLimit
    });

    // Try to get from cache
    const cachedData = await this.cache.get<StakerStats[]>(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    try {
      const sortOrder = order === 'asc' ? 1 : -1;
      const stakers = await Staker.find()
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean();

      const response = await Promise.all(stakers.map(async (staker) => {
        // Get unique blocks
        const uniqueBlocks = await Transaction.distinct('blockHeight', {
          stakerAddress: staker.address
        });

        // Get unique providers
        const uniqueProviders = await Transaction.distinct('finalityProvider', {
          stakerAddress: staker.address
        });

        let transactions: TransactionInfo[] = [];
        if (includeTransactions) {
          const txs = await Transaction.find(
            { stakerAddress: staker.address },
            { 
              txid: 1, 
              timestamp: 1, 
              stakeAmount: 1, 
              finalityProvider: 1 
            }
          )
          .skip(transactionsSkip)
          .limit(transactionsLimit)
          .lean();

          transactions = txs.map(tx => ({
            txid: tx.txid,
            timestamp: tx.timestamp,
            amount: tx.stakeAmount,
            amountBTC: tx.stakeAmount / 100000000,
            finalityProvider: tx.finalityProvider
          }));
        }

        return {
          address: staker.address,
          stakerPublicKey: staker.stakerPublicKey,
          totalStake: staker.totalStake.toString(),
          totalStakeBTC: staker.totalStake / 100000000,
          transactionCount: staker.transactionCount,
          uniqueProviders: uniqueProviders.length,
          uniqueBlocks: uniqueBlocks.length,
          timeRange: {
            firstTimestamp: staker.firstSeen,
            lastTimestamp: staker.lastSeen,
            durationSeconds: staker.lastSeen - staker.firstSeen
          },
          averageStakeBTC: (staker.totalStake / staker.transactionCount) / 100000000,
          versionsUsed: staker.versionsUsed || [],
          finalityProviders: uniqueProviders,
          activeStakes: staker.activeStakes,
          stats: {},
          phaseStakes: staker.phaseStakes?.map(phase => ({
            phase: phase.phase,
            totalStake: phase.totalStake,
            transactionCount: phase.transactionCount,
            finalityProviders: phase.finalityProviders
          })) || [],
          ...(includeTransactions && { transactions })
        };
      }));

      // Save to cache
      await this.cache.set(cacheKey, response, this.CACHE_TTL);

      return response;
    } catch (error) {
      logger.error('Error in getTopStakers:', error);
      throw error;
    }
  }

  // Cache invalidation methods
  private async invalidateStakerCache(address: string): Promise<void> {
    await this.cache.clearPattern(`${this.CACHE_PREFIX}:stats:address:${address}*`);
    await this.cache.clearPattern(`${this.CACHE_PREFIX}:top:*`);
  }

  async reindexStakers(): Promise<void> {
    try {
      logger.info('Starting staker reindexing...');
      
      const transactions = await Transaction.find({}).sort({ timestamp: 1 });
      
      // Group transactions by staker
      const stakerTransactions = new Map<string, Array<any>>();
      transactions.forEach(tx => {
        if (!stakerTransactions.has(tx.stakerAddress)) {
          stakerTransactions.set(tx.stakerAddress, []);
        }
        stakerTransactions.get(tx.stakerAddress)!.push(tx);
      });

      // Process each staker
      for (const [stakerAddress, txs] of stakerTransactions.entries()) {
        // Group transactions by phase
        const phaseTransactionsMap = new Map<number, Array<any>>();
        const phaseStakesMap = new Map<number, {
          totalStake: number;
          transactionCount: number;
          finalityProviders: Map<string, number>;
        }>();

        txs.forEach(tx => {
          const phase = tx.paramsVersion || 0;
          
          // Add to phase transactions
          if (!phaseTransactionsMap.has(phase)) {
            phaseTransactionsMap.set(phase, []);
          }
          phaseTransactionsMap.get(phase)!.push({
            txid: tx.txid,
            phase,
            timestamp: tx.timestamp,
            amount: tx.stakeAmount,
            finalityProvider: tx.finalityProvider
          });

          // Update phase stakes
          if (!phaseStakesMap.has(phase)) {
            phaseStakesMap.set(phase, {
              totalStake: 0,
              transactionCount: 0,
              finalityProviders: new Map()
            });
          }
          const phaseStats = phaseStakesMap.get(phase)!;
          phaseStats.totalStake += tx.stakeAmount;
          phaseStats.transactionCount += 1;
          
          const currentFPStake = phaseStats.finalityProviders.get(tx.finalityProvider) || 0;
          phaseStats.finalityProviders.set(tx.finalityProvider, currentFPStake + tx.stakeAmount);
        });

        // Convert phase stakes to array format
        const phaseStakes = Array.from(phaseStakesMap.entries()).map(([phase, stats]) => ({
          phase,
          totalStake: stats.totalStake,
          transactionCount: stats.transactionCount,
          finalityProviders: Array.from(stats.finalityProviders.entries()).map(([address, stake]) => ({
            address,
            stake
          }))
        }));

        // Convert phase transactions to array format
        const transactions = Array.from(phaseTransactionsMap.entries())
          .sort((a, b) => b[0] - a[0]) // Sort by phase in descending order
          .map(([phase, phaseTxs]) => ({
            phase,
            transactions: phaseTxs
          }));

        // Calculate total stats
        const totalStake = txs.reduce((sum, tx) => sum + tx.stakeAmount, 0);
        const uniqueFPs = new Set(txs.map(tx => tx.finalityProvider));
        const timestamps = txs.map(tx => tx.timestamp);

        // Update staker document
        await Staker.findOneAndUpdate(
          { address: stakerAddress },
          {
            address: stakerAddress,
            totalStake,
            transactionCount: txs.length,
            activeStakes: txs.filter(tx => !tx.isOverflow).length,
            finalityProviders: Array.from(uniqueFPs),
            firstSeen: Math.min(...timestamps),
            lastSeen: Math.max(...timestamps),
            transactions: transactions.flatMap(p => p.transactions),
            phaseStakes
          },
          { 
            upsert: true, 
            new: true,
            setDefaultsOnInsert: true
          }
        );
      }
      
      // Clear all staker-related cache after reindexing
      await this.cache.clearPattern(`${this.CACHE_PREFIX}:*`);
      
      logger.info('Staker reindexing completed');
    } catch (error) {
      logger.error('Error reindexing stakers:', error);
      throw error;
    }
  }

  async debugStakerSearch(address: string): Promise<void> {
    logger.info('\nDebugging staker search:');
    
    const exactMatch = await Staker.findOne({ address });
    logger.info('Exact match:', exactMatch?.address);

    const caseInsensitive = await Staker.findOne({ 
      address: { $regex: new RegExp('^' + address + '$', 'i') } 
    });
    logger.info('Case-insensitive match:', caseInsensitive?.address);

    const similar = await Staker.find({ 
      address: { $regex: new RegExp(address.substring(0, 10), 'i') }
    });
    logger.info('Similar addresses:', similar.map(s => s.address));

    const transaction = await Transaction.findOne({ stakerAddress: address });
    logger.info('Found in transactions:', transaction?.stakerAddress);
  }

  async getStakersCount(): Promise<number> {
    try {
      const count = await Staker.countDocuments({});
      logger.info('Total stakers:', count);
      return count;
    } catch (error) {
      logger.error('Error in getStakersCount:', error);
      throw error;
    }
  }

  async getStakerTotalTransactions(
    address: string,
    timeRange?: TimeRange
  ): Promise<number> {
    const query: any = { stakerAddress: address };
    
    if (timeRange) {
      query.timestamp = {
        $gte: timeRange.firstTimestamp,
        $lte: timeRange.lastTimestamp
      };
    }

    return Transaction.countDocuments(query);
  }

  async getGlobalStats(): Promise<GlobalStakerStats> {
    const pipeline: PipelineStage[] = [
      {
        $group: {
          _id: null,
          totalStake: { $sum: '$stakeAmount' },
          totalTransactions: { $sum: 1 },
          uniqueProviders: { $addToSet: '$finalityProvider' },
          uniqueStakers: { $addToSet: '$stakerAddress' }
        }
      }
    ];

    const [result] = await Transaction.aggregate(pipeline);
    const activeStakers = await Staker.countDocuments({ activeStakes: { $gt: 0 } });
    const totalStakers = await Staker.countDocuments();

    return {
      totalStake: result.totalStake.toString(),
      totalStakeBTC: result.totalStake / 100000000,
      averageStake: (result.totalStake / result.totalTransactions).toString(),
      averageStakeBTC: (result.totalStake / result.totalTransactions) / 100000000,
      uniqueProviders: result.uniqueProviders.length,
      totalTransactions: result.totalTransactions,
      activeStakers,
      totalStakers
    };
  }
}
