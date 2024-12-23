import { FinalityProvider } from '../models/FinalityProvider';
import { Transaction } from '../models/Transaction';
import { FinalityProviderStats, TimeRange, TopFinalityProviderStats } from '../../types';

interface QueryWithTimestamp {
  address: string;
  timestamp?: {
    $gte: number;
    $lte: number;
  };
}

export class FinalityProviderService {
  async getFPStats(address: string, timeRange?: TimeRange): Promise<FinalityProviderStats> {
    const query: QueryWithTimestamp = { address };
    if (timeRange) {
      query.timestamp = {
        $gte: timeRange.firstTimestamp,
        $lte: timeRange.lastTimestamp
      };
    }

    const fp = await FinalityProvider.findOne({ address }).lean();
    if (!fp) {
      throw new Error(`Finality Provider not found: ${address}`);
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

    const stakerTransactions = await Transaction.find(
      { 
        finalityProvider: address,
        ...(timeRange && {
          timestamp: {
            $gte: timeRange.firstTimestamp,
            $lte: timeRange.lastTimestamp
          }
        })
      },
      { stakerAddress: 1, timestamp: 1 }
    ).lean();

    const stakerAddresses = [...new Set(stakerTransactions.map(tx => tx.stakerAddress))];

    let phaseStakes = fp.phaseStakes?.map(phase => ({
      phase: phase.phase,
      totalStake: phase.totalStake,
      transactionCount: phase.transactionCount,
      stakerCount: phase.stakerCount,
      stakers: phase.stakers.map(staker => ({
        address: staker.address,
        stake: staker.stake
      }))
    }));

    if (timeRange) {
      const transactions = await Transaction.find({
        finalityProvider: address,
        timestamp: {
          $gte: timeRange.firstTimestamp,
          $lte: timeRange.lastTimestamp
        }
      }).lean();

      const phaseTransactions = new Map<number, any[]>();
      transactions.forEach(tx => {
        const phase = (tx as any).phase || 0;
        if (!phaseTransactions.has(phase)) {
          phaseTransactions.set(phase, []);
        }
        phaseTransactions.get(phase)!.push(tx);
      });

      phaseStakes = Array.from(phaseTransactions.entries()).map(([phase, txs]) => {
        const totalStake = txs.reduce((sum, tx) => sum + tx.stakeAmount, 0);
        const uniqueStakers = new Set(txs.map(tx => tx.stakerAddress));
        const stakerStakes = new Map<string, number>();
        
        txs.forEach(tx => {
          const currentStake = stakerStakes.get(tx.stakerAddress) || 0;
          stakerStakes.set(tx.stakerAddress, currentStake + tx.stakeAmount);
        });

        return {
          phase,
          totalStake,
          transactionCount: txs.length,
          stakerCount: uniqueStakers.size,
          stakers: Array.from(stakerStakes.entries()).map(([address, stake]) => ({
            address,
            stake
          }))
        };
      });
    }

    return {
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
      stakerAddresses,
      stats: {},
      phaseStakes
    };
  }

  async getAllFPs(
    skip: number = 0,
    limit: number = 10,
    sortBy: string = 'totalStake',
    order: 'asc' | 'desc' = 'desc',
    includeStakers: boolean = false
  ): Promise<FinalityProviderStats[]> {
    console.log('Getting all FPs with params:', { skip, limit, sortBy, order, includeStakers });
    
    try {
      const sortOrder = order === 'asc' ? 1 : -1;
      const collection = FinalityProvider.collection;

      const fps = await FinalityProvider.find()
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean();
      
      console.log('Found FPs:', fps.length);
      
      return Promise.all(fps.map(async (fp) => {
        const uniqueBlocks = await Transaction.distinct('blockHeight', {
          finalityProvider: fp.address
        });

        let stakerAddresses: string[] = [];
        if (includeStakers) {
          const stakerTransactions = await Transaction.find(
            { finalityProvider: fp.address },
            { stakerAddress: 1 }
          ).lean();
          stakerAddresses = [...new Set(stakerTransactions.map(tx => tx.stakerAddress))];
        }

        return {
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
          ...(includeStakers && { stakerAddresses }),
          stats: {},
          phaseStakes: fp.phaseStakes?.map(phase => ({
            phase: phase.phase,
            totalStake: phase.totalStake,
            transactionCount: phase.transactionCount,
            stakerCount: phase.stakerCount,
            ...(includeStakers && {
              stakers: phase.stakers.map(staker => ({
                address: staker.address,
                stake: staker.stake
              }))
            })
          }))
        };
      }));
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
    const fps = await FinalityProvider.find()
      .sort({ totalStake: -1 })
      .limit(limit)
      .lean();

    const totalStake = fps.reduce((sum, fp) => sum + fp.totalStake, 0);

    const results = await Promise.all(fps.map(async (fp, index) => {
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

    return results;
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
      
      console.log('Finality provider reindexing completed');
    } catch (error) {
      console.error('Error reindexing finality providers:', error);
      throw error;
    }
  }
}
