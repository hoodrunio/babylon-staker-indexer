import { Staker } from '../models/Staker';
import { Transaction } from '../models/Transaction';
import { StakerStats, TimeRange } from '../../types';

interface QueryWithTimestamp {
  address: string;
  timestamp?: {
    $gte: number;
    $lte: number;
  };
}

interface StakeTransactionInfo {
  txid: string;
  timestamp: number;
  amount: number;
  amountBTC: number;
  finalityProvider: string;
}

interface PhaseTransactions {
  phase: number;
  transactions: StakeTransactionInfo[];
}

export class StakerService {
  async getStakerStats(address: string, timeRange?: TimeRange): Promise<StakerStats> {
    const query: QueryWithTimestamp = { address };
    if (timeRange) {
      query.timestamp = {
        $gte: timeRange.firstTimestamp,
        $lte: timeRange.lastTimestamp
      };
    }

    const staker = await Staker.findOne(query);
    if (!staker) {
      throw new Error(`Staker not found: ${address}`);
    }

    const uniqueBlocks = await Transaction.distinct('blockHeight', {
      stakerAddress: address,
      ...(timeRange && {
        timestamp: {
          $gte: timeRange.firstTimestamp,
          $lte: timeRange.lastTimestamp
        }
      })
    });

    const transactionQuery = {
      stakerAddress: address,
      ...(timeRange && {
        timestamp: {
          $gte: timeRange.firstTimestamp,
          $lte: timeRange.lastTimestamp
        }
      })
    };

    const transactions = await Transaction.find(transactionQuery)
      .sort({ timestamp: -1 })
      .lean();

    const phaseTransactionsMap = new Map<number, StakeTransactionInfo[]>();
    
    transactions.forEach(tx => {
      const phase = tx.paramsVersion || 0;
      if (!phaseTransactionsMap.has(phase)) {
        phaseTransactionsMap.set(phase, []);
      }
      
      phaseTransactionsMap.get(phase)!.push({
        txid: tx.txid,
        timestamp: tx.timestamp,
        amount: tx.stakeAmount,
        amountBTC: tx.stakeAmount / 100000000,
        finalityProvider: tx.finalityProvider
      });
    });

    const phaseTransactions: PhaseTransactions[] = Array.from(phaseTransactionsMap.entries())
      .map(([phase, txs]) => ({
        phase,
        transactions: txs
      }))
      .sort((a, b) => b.phase - a.phase);

    let phaseStakes = staker.phaseStakes?.map(phase => ({
      phase: phase.phase,
      totalStake: phase.totalStake,
      transactionCount: phase.transactionCount,
      finalityProviders: phase.finalityProviders.map(fp => ({
        address: fp.address,
        stake: fp.stake
      }))
    }));

    if (timeRange) {
      phaseStakes = Array.from(phaseTransactionsMap.entries()).map(([phase, txs]) => {
        const totalStake = txs.reduce((sum, tx) => sum + tx.amount, 0);
        const fpStakes = new Map<string, number>();
        
        txs.forEach(tx => {
          const currentStake = fpStakes.get(tx.finalityProvider) || 0;
          fpStakes.set(tx.finalityProvider, currentStake + tx.amount);
        });

        return {
          phase,
          totalStake,
          transactionCount: txs.length,
          finalityProviders: Array.from(fpStakes.entries()).map(([address, stake]) => ({
            address,
            stake
          }))
        };
      });
    }

    return {
      address: staker.address,
      totalStakeBTC: staker.totalStake / 100000000,
      transactionCount: staker.transactionCount,
      uniqueBlocks: uniqueBlocks.length,
      timeRange: {
        firstTimestamp: staker.firstSeen,
        lastTimestamp: staker.lastSeen,
        durationSeconds: staker.lastSeen - staker.firstSeen
      },
      finalityProviders: staker.finalityProviders,
      activeStakes: staker.activeStakes,
      phaseStakes,
      transactions: phaseTransactions
    };
  }

  async getTopStakers(limit: number = 10): Promise<StakerStats[]> {
    const stakers = await Staker.find()
      .sort({ totalStake: -1 })
      .limit(limit);

    const results = await Promise.all(stakers.map(async (staker) => {
      const uniqueBlocks = await Transaction.distinct('blockHeight', {
        stakerAddress: staker.address
      });

      const phaseStakes = staker.phaseStakes?.map(phase => ({
        phase: phase.phase,
        totalStake: phase.totalStake,
        transactionCount: phase.transactionCount,
        finalityProviders: phase.finalityProviders.map(fp => ({
          address: fp.address,
          stake: fp.stake
        }))
      }));

      return {
        address: staker.address,
        totalStakeBTC: staker.totalStake / 100000000,
        transactionCount: staker.transactionCount,
        uniqueBlocks: uniqueBlocks.length,
        timeRange: {
          firstTimestamp: staker.firstSeen,
          lastTimestamp: staker.lastSeen,
          durationSeconds: staker.lastSeen - staker.firstSeen
        },
        finalityProviders: staker.finalityProviders,
        activeStakes: staker.activeStakes,
        phaseStakes
      };
    }));

    return results;
  }

  async reindexStakers(): Promise<void> {
    try {
      console.log('Starting staker reindexing...');
      
      const transactions = await Transaction.find({});
      
      for (const tx of transactions) {
        await Staker.findOneAndUpdate(
          { address: tx.stakerAddress },
          {
            address: tx.stakerAddress,
            $inc: { 
              totalStake: tx.stakeAmount,
              transactionCount: 1,
              activeStakes: 1
            },
            $addToSet: { finalityProviders: tx.finalityProvider },
            $min: { firstSeen: tx.timestamp },
            $max: { lastSeen: tx.timestamp }
          },
          { 
            upsert: true, 
            new: true,
            setDefaultsOnInsert: true
          }
        );
      }
      
      console.log('Staker reindexing completed');
    } catch (error) {
      console.error('Error reindexing stakers:', error);
      throw error;
    }
  }

  async debugStakerSearch(address: string): Promise<void> {
    console.log('\nDebugging staker search:');
    
    const exactMatch = await Staker.findOne({ address });
    console.log('Exact match:', exactMatch?.address);

    const caseInsensitive = await Staker.findOne({ 
      address: { $regex: new RegExp('^' + address + '$', 'i') } 
    });
    console.log('Case-insensitive match:', caseInsensitive?.address);

    const similar = await Staker.find({ 
      address: { $regex: new RegExp(address.substring(0, 10), 'i') }
    });
    console.log('Similar addresses:', similar.map(s => s.address));

    const transaction = await Transaction.findOne({ stakerAddress: address });
    console.log('Found in transactions:', transaction?.stakerAddress);
  }
}
