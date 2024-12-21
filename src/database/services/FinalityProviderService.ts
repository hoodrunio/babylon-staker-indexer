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

    const fp = await FinalityProvider.findOne(query);
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
    ).sort({ timestamp: -1 });

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
      });

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
      phaseStakes
    };
  }

  async getAllFPs(): Promise<FinalityProviderStats[]> {
    const fps = await FinalityProvider.find();
    
    return Promise.all(fps.map(async (fp) => {
      const uniqueBlocks = await Transaction.distinct('blockHeight', {
        finalityProvider: fp.address
      });

      const stakerTransactions = await Transaction.find(
        { finalityProvider: fp.address },
        { stakerAddress: 1 }
      );

      const stakerAddresses = [...new Set(stakerTransactions.map(tx => tx.stakerAddress))];

      return {
        address: fp.address,
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
        phaseStakes: fp.phaseStakes?.map(phase => ({
          phase: phase.phase,
          totalStake: phase.totalStake,
          transactionCount: phase.transactionCount,
          stakerCount: phase.stakerCount,
          stakers: phase.stakers.map(staker => ({
            address: staker.address,
            stake: staker.stake
          }))
        }))
      };
    }));
  }

  async getTopFPs(limit: number = 10): Promise<TopFinalityProviderStats[]> {
    const fps = await FinalityProvider.find()
      .sort({ totalStake: -1 })
      .limit(limit);

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
        rank: index + 1,
        stakingShare: totalStake > 0 ? (fp.totalStake / totalStake) * 100 : 0,
        address: fp.address,
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
        phaseStakes
      };
    }));

    return results;
  }
}
