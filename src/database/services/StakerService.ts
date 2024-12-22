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

  async getTopStakers(
    skip: number = 0,
    limit: number = 10,
    sortBy: string = 'totalStake',
    order: 'asc' | 'desc' = 'desc',
    includeTransactions: boolean = false
  ): Promise<StakerStats[]> {
    console.log('Getting top stakers with params:', { skip, limit, sortBy, order, includeTransactions });
    
    try {
      const sortOrder = order === 'asc' ? 1 : -1;
      const stakers = await Staker.find()
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean();

      console.log('Found stakers:', stakers.length);

      return Promise.all(stakers.map(async (staker) => {
        const uniqueBlocks = await Transaction.distinct('blockHeight', {
          stakerAddress: staker.address
        });

        let transactions: PhaseTransactions[] = [];
        if (includeTransactions) {
          const txs = await Transaction.find({ stakerAddress: staker.address })
            .sort({ timestamp: -1 })
            .lean();

          const phaseTransactionsMap = new Map<number, StakeTransactionInfo[]>();
          
          txs.forEach(tx => {
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

          transactions = Array.from(phaseTransactionsMap.entries())
            .map(([phase, txs]) => ({
              phase,
              transactions: txs
            }))
            .sort((a, b) => b.phase - a.phase);
        }

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
          phaseStakes,
          ...(includeTransactions && { transactions })
        };
      }));
    } catch (error) {
      console.error('Error in getTopStakers:', error);
      throw error;
    }
  }

  async reindexStakers(): Promise<void> {
    try {
      console.log('Starting staker reindexing...');
      
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

  async getStakersCount(): Promise<number> {
    try {
      const count = await Staker.countDocuments({});
      console.log('Total stakers:', count);
      return count;
    } catch (error) {
      console.error('Error in getStakersCount:', error);
      throw error;
    }
  }
}
