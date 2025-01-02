import { FinalityProvider } from '../models/FinalityProvider';
import { Transaction } from '../models/Transaction';
import { FinalityProviderStats, TimeRange, TopFinalityProviderStats } from '../../types';
import { PipelineStage } from 'mongoose';
import { CacheService } from '../../services/CacheService';

interface QueryWithTimestamp {
  address: string;
  timestamp?: {
    $gte: number;
    $lte: number;
  };
}

export class FinalityProviderService {
  private cache: CacheService;
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CACHE_PREFIX = 'fp';

  constructor() {
    this.cache = CacheService.getInstance();
  }

  private generateCacheKey(method: string, params: Record<string, any>): string {
    return this.cache.generateKey(`${this.CACHE_PREFIX}:${method}`, params);
  }

  async getFPStats(
    address: string, 
    timeRange?: TimeRange,
    skip: number = 0,
    limit: number = 50
  ): Promise<FinalityProviderStats> {
    const cacheKey = this.generateCacheKey('stats', {
      address,
      timeRange,
      skip,
      limit
    });

    // Try to get from cache
    const cachedData = await this.cache.get<FinalityProviderStats>(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const fp = await FinalityProvider.findOne({ address }).lean();
    if (!fp) {
      throw new Error(`Finality Provider not found: ${address}`);
    }

    let phaseStakes: FinalityProviderStats['phaseStakes'] = fp.phaseStakes?.map(phase => ({
      phase: phase.phase,
      totalStake: phase.totalStake,
      transactionCount: phase.transactionCount,
      stakerCount: phase.stakerCount,
      stakers: []
    })) || [];

    if (timeRange) {
      const transactions = await Transaction.find({
        finalityProvider: address,
        timestamp: {
          $gte: timeRange.firstTimestamp,
          $lte: timeRange.lastTimestamp
        }
      })
      .sort({ timestamp: -1 })
      .lean();

      const phaseTransactions = new Map<number, any[]>();
      transactions.forEach(tx => {
        const phase = (tx as any).paramsVersion + 1 || 0;
        if (!phaseTransactions.has(phase)) {
          phaseTransactions.set(phase, []);
        }
        phaseTransactions.get(phase)!.push(tx);
      });

      phaseStakes = Array.from(phaseTransactions.entries()).map(([phase, txs]) => {
        const totalStake = txs.reduce((sum, tx) => sum + tx.stakeAmount, 0);
        const uniqueStakers = new Set(txs.map(tx => tx.stakerAddress));
        const stakerStakes = new Map<string, {
          stake: number;
          timestamp: number;
          txId: string;
        }>();
        
        txs.forEach(tx => {
          if (!stakerStakes.has(tx.stakerAddress)) {
            stakerStakes.set(tx.stakerAddress, {
              stake: 0,
              timestamp: tx.timestamp,
              txId: tx.txid
            });
          }
          const staker = stakerStakes.get(tx.stakerAddress)!;
          staker.stake += tx.stakeAmount;
          // Update timestamp and txId only if this transaction is newer
          if (tx.timestamp > staker.timestamp) {
            staker.timestamp = tx.timestamp;
            staker.txId = tx.txid;
          }
        });

        return {
          phase,
          totalStake,
          transactionCount: txs.length,
          stakerCount: uniqueStakers.size,
          stakers: Array.from(stakerStakes.entries())
            .sort((a, b) => b[1].stake - a[1].stake)
            .slice(skip, skip + limit)
            .map(([address, data]) => ({
              address,
              stake: data.stake,
              timestamp: data.timestamp,
              txId: data.txId
            }))
        };
      });
    } else {
      // When no time range is specified, get stakers for each phase separately
      const pipeline: PipelineStage[] = [
        {
          $match: {
            finalityProvider: address
          }
        },
        {
          $group: {
            _id: {
              phase: { $add: ['$paramsVersion', 1] },
              stakerAddress: '$stakerAddress'
            },
            stake: { $sum: '$stakeAmount' },
            lastTransaction: { $last: '$$ROOT' }
          }
        },
        {
          $group: {
            _id: '$_id.phase',
            totalStake: { $sum: '$stake' },
            stakerCount: { $sum: 1 },
            stakers: {
              $push: {
                address: '$_id.stakerAddress',
                stake: '$stake',
                timestamp: '$lastTransaction.timestamp',
                txId: '$lastTransaction.txid'
              }
            }
          }
        },
        { $sort: { '_id': 1 } }
      ];

      const phaseStakersResult = await Transaction.aggregate(pipeline);

      phaseStakes = phaseStakersResult.map(phaseData => ({
        phase: phaseData._id,
        totalStake: phaseData.totalStake,
        transactionCount: phaseData.stakerCount, // Using stakerCount as transactionCount since we don't have the actual count
        stakerCount: phaseData.stakerCount,
        stakers: phaseData.stakers
          .sort((a: any, b: any) => b.stake - a.stake)
          .slice(skip, skip + limit)
      }));
    }

    const uniqueBlocks = await Transaction.distinct('blockHeight', {
      finalityProvider: address,
      ...(timeRange && {
        timestamp: {
          $gte: timeRange.firstTimestamp,
          $lte: timeRange.lastTimestamp
        }
      })
    });

    const response: FinalityProviderStats = {
      address: fp.address,
      totalStake: fp.totalStake.toString(),
      createdAt: Math.floor(new Date(fp.createdAt || fp.firstSeen).getTime() / 1000),
      updatedAt: Math.floor(new Date(fp.updatedAt || fp.lastSeen).getTime() / 1000),
      totalStakeBTC: fp.totalStake / 100000000,
      transactionCount: fp.transactionCount,
      uniqueStakers: fp.uniqueStakers.length,
      uniqueBlocks: uniqueBlocks.length,
      timeRange: {
        firstTimestamp: fp.firstSeen,
        lastTimestamp: fp.lastSeen,
        durationSeconds: fp.lastSeen - fp.firstSeen
      },
      averageStakeBTC: (fp.totalStake / fp.transactionCount) / 100000000,
      versionsUsed: fp.versionsUsed,
      stats: {},
      phaseStakes
    };

    // Save to cache
    await this.cache.set(cacheKey, response, this.CACHE_TTL);

    return response;
  }

  async getAllFPs(
    skip: number = 0,
    limit: number = 10,
    sortBy: string = 'totalStake',
    order: 'asc' | 'desc' = 'desc',
    includeStakers: boolean = false,
    stakersSkip: number = 0,
    stakersLimit: number = 50
  ): Promise<FinalityProviderStats[]> {
    const cacheKey = this.generateCacheKey('all', {
      skip,
      limit,
      sortBy,
      order,
      includeStakers,
      stakersSkip,
      stakersLimit
    });

    // Try to get from cache
    const cachedData = await this.cache.get<FinalityProviderStats[]>(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    try {
      const sortOrder = order === 'asc' ? 1 : -1;
      
      const pipeline: PipelineStage[] = [
        {
          $group: {
            _id: '$finalityProvider',
            totalStake: { $sum: '$stakeAmount' },
            transactionCount: { $sum: 1 },
            uniqueStakers: { $addToSet: '$stakerAddress' },
            uniqueBlocks: { $addToSet: '$blockHeight' },
            firstSeen: { $min: '$timestamp' },
            lastSeen: { $max: '$timestamp' },
            versionsUsed: { $addToSet: '$version' }
          }
        },
        {
          $project: {
            _id: 0,
            address: '$_id',
            totalStake: 1,
            totalStakeBTC: { $divide: ['$totalStake', 100000000] },
            transactionCount: 1,
            uniqueStakers: { $size: '$uniqueStakers' },
            uniqueBlocks: { $size: '$uniqueBlocks' },
            timeRange: {
              firstTimestamp: '$firstSeen',
              lastTimestamp: '$lastSeen',
              durationSeconds: { $subtract: ['$lastSeen', '$firstSeen'] }
            },
            averageStakeBTC: {
              $divide: [
                { $divide: ['$totalStake', '$transactionCount'] },
                100000000
              ]
            },
            versionsUsed: 1
          }
        },
        { $sort: { [sortBy]: sortOrder } },
        { $skip: skip },
        { $limit: limit }
      ];

      if (includeStakers) {
        pipeline.push({
          $lookup: {
            from: 'transactions',
            let: { fpAddress: '$address' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$finalityProvider', '$$fpAddress'] }
                }
              },
              { $sort: { timestamp: -1 } },
              { $skip: stakersSkip },
              { $limit: stakersLimit },
              {
                $project: {
                  _id: 0,
                  stakerAddress: 1,
                  stakeAmount: 1
                }
              }
            ],
            as: 'stakerAddresses'
          }
        });
      }

      const fps = await Transaction.aggregate(pipeline);
      
      const response = await Promise.all(fps.map(async (fp) => {
        const fpDoc = await FinalityProvider.findOne({ address: fp.address }).lean();
        
        return {
          ...fp,
          phaseStakes: fpDoc?.phaseStakes?.map(phase => ({
            phase: phase.phase,
            totalStake: phase.totalStake,
            transactionCount: phase.transactionCount,
            stakerCount: phase.stakerCount,
            ...(includeStakers && {
              stakers: phase.stakers
                .slice(stakersSkip, stakersSkip + stakersLimit)
                .map(staker => ({
                  address: staker.address,
                  stake: staker.stake
                }))
            })
          })) || [],
          stats: {}
        };
      }));

      // Save to cache
      await this.cache.set(cacheKey, response, this.CACHE_TTL);

      return response;
    } catch (error) {
      console.error('Error in getAllFPs:', error);
      throw error;
    }
  }

  async getFinalityProvidersCount(): Promise<number> {
    try {
      const count = await FinalityProvider.countDocuments({});
      console.log('Total finality providers:', count);
      return count;
    } catch (error) {
      console.error('Error in getFinalityProvidersCount:', error);
      throw error;
    }
  }

  async getTopFPs(limit: number = 10): Promise<TopFinalityProviderStats[]> {
    const cacheKey = this.generateCacheKey('top', { limit });

    // Try to get from cache
    const cachedData = await this.cache.get<TopFinalityProviderStats[]>(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const fps = await FinalityProvider.find()
      .sort({ totalStake: -1 })
      .limit(limit)
      .lean();

    const totalStake = fps.reduce((sum, fp) => sum + fp.totalStake, 0);

    const response = await Promise.all(fps.map(async (fp, index) => {
      const uniqueBlocks = await Transaction.distinct('blockHeight', {
        finalityProvider: fp.address
      });

      const phaseStakes = fp.phaseStakes?.map(phase => ({
        phase: phase.phase,
        totalStake: phase.totalStake,
        transactionCount: phase.transactionCount,
        stakerCount: phase.stakerCount,
        stakers: phase.stakers.map(staker => ({
          address: staker.address,
          stake: staker.stake
        }))
      }));

      return {
        address: fp.address,
        totalStake: fp.totalStake.toString(),
        createdAt: Math.floor(new Date(fp.createdAt || fp.firstSeen).getTime() / 1000),
        updatedAt: Math.floor(new Date(fp.updatedAt || fp.lastSeen).getTime() / 1000),
        rank: index + 1,
        stakingShare: totalStake > 0 ? (fp.totalStake / totalStake) * 100 : 0,
        totalStakeBTC: fp.totalStake / 100000000,
        transactionCount: fp.transactionCount,
        uniqueStakers: fp.uniqueStakers.length,
        uniqueBlocks: uniqueBlocks.length,
        timeRange: {
          firstTimestamp: fp.firstSeen,
          lastTimestamp: fp.lastSeen,
          durationSeconds: fp.lastSeen - fp.firstSeen
        },
        averageStakeBTC: (fp.totalStake / fp.transactionCount) / 100000000,
        versionsUsed: fp.versionsUsed,
        stakerAddresses: fp.uniqueStakers,
        stats: {},
        phaseStakes
      };
    }));

    // Save to cache
    await this.cache.set(cacheKey, response, this.CACHE_TTL);

    return response;
  }

  async reindexFinalityProviders(): Promise<void> {
    try {
      console.log('Starting finality provider reindexing...');
      
      const transactions = await Transaction.find({}).sort({ timestamp: 1 });
      
      // Group transactions by finality provider
      const fpTransactions = new Map<string, Array<any>>();
      transactions.forEach(tx => {
        if (!fpTransactions.has(tx.finalityProvider)) {
          fpTransactions.set(tx.finalityProvider, []);
        }
        fpTransactions.get(tx.finalityProvider)!.push(tx);
      });

      // Process each finality provider
      for (const [fpAddress, txs] of fpTransactions.entries()) {
        const activeTxs = txs.filter(tx => !tx.isOverflow);

        // Group transactions by phase
        const phaseStakesMap = new Map<number, {
          totalStake: number;
          transactionCount: number;
          stakerCount: number;
          stakers: Map<string, number>;
        }>();

        activeTxs.forEach(tx => {
          const phase = tx.paramsVersion || 0;
          
          // Initialize phase stats if not exists
          if (!phaseStakesMap.has(phase)) {
            phaseStakesMap.set(phase, {
              totalStake: 0,
              transactionCount: 0,
              stakerCount: 0,
              stakers: new Map()
            });
          }

          const phaseStats = phaseStakesMap.get(phase)!;
          phaseStats.totalStake += tx.stakeAmount;
          phaseStats.transactionCount += 1;
          
          // Update staker's stake in this phase
          const currentStake = phaseStats.stakers.get(tx.stakerAddress) || 0;
          phaseStats.stakers.set(tx.stakerAddress, currentStake + tx.stakeAmount);
        });

        // Convert phase stakes to array format
        const phaseStakes = Array.from(phaseStakesMap.entries()).map(([phase, stats]) => ({
          phase,
          totalStake: stats.totalStake,
          transactionCount: stats.transactionCount,
          stakerCount: stats.stakers.size,
          stakers: Array.from(stats.stakers.entries()).map(([address, stake]) => ({
            address,
            stake
          }))
        }));

        // Calculate total stats
        const totalStake = activeTxs.reduce((sum, tx) => sum + tx.stakeAmount, 0);
        const uniqueStakers = new Set(activeTxs.map(tx => tx.stakerAddress));
        const versions = new Set(activeTxs.map(tx => tx.version));
        const timestamps = activeTxs.map(tx => tx.timestamp);

        // Update finality provider document
        await FinalityProvider.findOneAndUpdate(
          { address: fpAddress },
          {
            address: fpAddress,
            totalStake,
            transactionCount: activeTxs.length,
            uniqueStakers: Array.from(uniqueStakers),
            firstSeen: Math.min(...timestamps),
            lastSeen: Math.max(...timestamps),
            versionsUsed: Array.from(versions),
            phaseStakes
          },
          { 
            upsert: true, 
            new: true,
            setDefaultsOnInsert: true
          }
        );
      }
      
      // Clear all FP-related cache after reindexing
      await this.cache.clearPattern(`${this.CACHE_PREFIX}:*`);
      
      console.log('Finality provider reindexing completed');
    } catch (error) {
      console.error('Error reindexing finality providers:', error);
      throw error;
    }
  }

  async getFinalityProviderTotalStakers(
    address: string,
    timeRange?: TimeRange
  ): Promise<number> {
    const query: any = { finalityProvider: address };
    
    if (timeRange) {
      query.timestamp = {
        $gte: timeRange.firstTimestamp,
        $lte: timeRange.lastTimestamp
      };
    }

    const uniqueStakers = await Transaction.distinct('stakerAddress', query);
    return uniqueStakers.length;
  }

  // Cache invalidation methods
  private async invalidateFPCache(address: string): Promise<void> {
    await this.cache.clearPattern(`${this.CACHE_PREFIX}:*:address:${address}*`);
    await this.cache.clearPattern(`${this.CACHE_PREFIX}:all:*`);
    await this.cache.clearPattern(`${this.CACHE_PREFIX}:top:*`);
  }
}
