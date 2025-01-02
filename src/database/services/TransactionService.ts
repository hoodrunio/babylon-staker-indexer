import { Transaction } from '../models/Transaction';
import { FinalityProvider } from '../models/FinalityProvider';
import { Staker } from '../models/Staker';
import { StakeTransaction } from '../../types';

export class TransactionService {
  async saveTransaction(tx: StakeTransaction): Promise<void> {
    try {
      // Check if transaction exists
      const existingTx = await Transaction.findOne({ txid: tx.txid });
      if (existingTx) {
        console.log(`Transaction ${tx.txid} already exists, skipping...`);
        return;
      }

      // Get phase for transaction
      const { getPhaseForHeight } = await import('../../config/phase-config');
      const phaseConfig = getPhaseForHeight(tx.blockHeight);
      const phase = phaseConfig?.phase || 0;
      (tx as any).phase = phase;

      // Save transaction
      await Transaction.create(tx);

      // Create maps for single transaction
      const fpTransactions = new Map<string, Array<StakeTransaction>>();
      const stakerTransactions = new Map<string, Array<StakeTransaction>>();

      fpTransactions.set(tx.finalityProvider, [tx]);
      stakerTransactions.set(tx.stakerAddress, [tx]);

      // Update finality providers and stakers with phase information
      await this.updateFinalityProvidersAndStakers(fpTransactions, stakerTransactions);

      console.log(`Transaction ${tx.txid} saved successfully`);

    } catch (error) {
      console.error('Error saving transaction:', error);
      console.error('Error details:', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  async saveTransactionBatch(transactions: Array<StakeTransaction & { isValid: boolean }>): Promise<void> {
    try {
      const babylonTransactions = transactions.filter(tx => tx.isValid || tx.isOverflow);
      if (babylonTransactions.length === 0) return;

      const txids = babylonTransactions.map(tx => tx.txid);
      const existingTxs = await Transaction.find({ txid: { $in: txids } }, { txid: 1 });
      const existingTxIds = new Set(existingTxs.map(tx => tx.txid));

      const newTransactions = babylonTransactions.filter(tx => !existingTxIds.has(tx.txid));
      if (newTransactions.length === 0) {
        console.log('All transactions already exist in database, skipping batch...');
        return;
      }

      // Group transactions by finality provider and staker
      const fpTransactions = new Map<string, Array<StakeTransaction>>();
      const stakerTransactions = new Map<string, Array<StakeTransaction>>();
      
      for (const tx of newTransactions) {
        const { getPhaseForHeight } = await import('../../config/phase-config');
        const phaseConfig = getPhaseForHeight(tx.blockHeight);
        const phase = phaseConfig?.phase || 0;

        (tx as any).phase = phase;

        if (!fpTransactions.has(tx.finalityProvider)) {
          fpTransactions.set(tx.finalityProvider, []);
        }
        fpTransactions.get(tx.finalityProvider)!.push(tx);

        if (!stakerTransactions.has(tx.stakerAddress)) {
          stakerTransactions.set(tx.stakerAddress, []);
        }
        stakerTransactions.get(tx.stakerAddress)!.push(tx);
      }

      await Transaction.insertMany(newTransactions, { ordered: false }).catch(err => {
        if (err.code !== 11000) {
          throw err;
        }
      });

      // Update finality providers and stakers
      await this.updateFinalityProvidersAndStakers(fpTransactions, stakerTransactions);
      
      const overflowCount = newTransactions.filter(tx => tx.isOverflow).length;
      console.log(`Successfully saved ${newTransactions.length} new transactions (${overflowCount} overflow)`);

    } catch (error) {
      console.error('Error in batch save:', error);
      throw error;
    }
  }

  private async updateFinalityProvidersAndStakers(
    fpTransactions: Map<string, Array<StakeTransaction>>,
    stakerTransactions: Map<string, Array<StakeTransaction>>
  ): Promise<void> {
    const fpUpdates = Array.from(fpTransactions.entries()).map(async ([fpAddress, txs]) => {
      const activeTxs = txs.filter(tx => !tx.isOverflow);
      const totalStake = activeTxs.reduce((sum, tx) => sum + tx.stakeAmount, 0);
      const uniqueStakers = [...new Set(activeTxs.map(tx => tx.stakerAddress))];
      const versions = [...new Set(activeTxs.map(tx => tx.version))];
      const timestamps = activeTxs.map(tx => tx.timestamp);

      // Get existing FP document to merge phase stakes
      const existingFP = await FinalityProvider.findOne({ address: fpAddress });
      const existingPhaseStakes = existingFP?.phaseStakes || [];

      // Convert existing phase stakes to map for easier merging
      const phaseStakesMap = new Map<number, {
        totalStake: number;
        transactionCount: number;
        stakerCount: number;
        stakers: Map<string, number>;
      }>();

      // Initialize map with existing phase stakes
      existingPhaseStakes.forEach(ps => {
        phaseStakesMap.set(ps.phase, {
          totalStake: ps.totalStake,
          transactionCount: ps.transactionCount,
          stakerCount: ps.stakerCount,
          stakers: new Map(ps.stakers.map(s => [s.address, s.stake]))
        });
      });

      // Update map with new transactions
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

      await FinalityProvider.findOneAndUpdate(
        { address: fpAddress },
        {
          $inc: { 
            totalStake: totalStake,
            transactionCount: activeTxs.length
          },
          $addToSet: { 
            uniqueStakers: { $each: uniqueStakers },
            versionsUsed: { $each: versions }
          },
          $min: { firstSeen: Math.min(...timestamps) },
          $max: { lastSeen: Math.max(...timestamps) },
          $set: {
            phaseStakes: phaseStakes
          }
        },
        { upsert: true }
      );
    });

    const stakerUpdates = Array.from(stakerTransactions.entries()).map(async ([stakerAddress, txs]) => {
      const activeTxs = txs.filter(tx => !tx.isOverflow);
      const totalStake = activeTxs.reduce((sum, tx) => sum + tx.stakeAmount, 0);
      const uniqueFPs = [...new Set(activeTxs.map(tx => tx.finalityProvider))];
      const timestamps = activeTxs.map(tx => tx.timestamp);

      // Get existing staker document to merge phase stakes and transactions
      const existingStaker = await Staker.findOne({ address: stakerAddress });
      const existingPhaseStakes = existingStaker?.phaseStakes || [];
      const existingTransactions = existingStaker?.transactions || [];

      // Convert existing phase stakes to map for easier merging
      const phaseStakesMap = new Map<number, {
        totalStake: number;
        transactionCount: number;
        finalityProviders: Map<string, number>;
      }>();

      // Initialize map with existing phase stakes
      existingPhaseStakes.forEach(ps => {
        phaseStakesMap.set(ps.phase, {
          totalStake: ps.totalStake,
          transactionCount: ps.transactionCount,
          finalityProviders: new Map(ps.finalityProviders.map(fp => [fp.address, fp.stake]))
        });
      });

      // Group transactions by phase
      const phaseTransactionsMap = new Map<number, Array<{
        txid: string;
        phase: number;
        timestamp: number;
        amount: number;
        finalityProvider: string;
      }>>();

      // Initialize with existing transactions
      existingTransactions.forEach((tx: {
        txid: string;
        phase: number;
        timestamp: number;
        amount: number;
        finalityProvider: string;
      }) => {
        const phase = tx.phase || 0;
        if (!phaseTransactionsMap.has(phase)) {
          phaseTransactionsMap.set(phase, []);
        }
        phaseTransactionsMap.get(phase)!.push(tx);
      });

      // Update with new transactions
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

      // Convert phase transactions to array format and sort by timestamp
      const transactions = Array.from(phaseTransactionsMap.entries())
        .sort((a, b) => b[0] - a[0]) // Sort by phase in descending order
        .flatMap(([_, phaseTxs]) => phaseTxs)
        .sort((a, b) => b.timestamp - a.timestamp); // Sort by timestamp in descending order

      await Staker.findOneAndUpdate(
        { address: stakerAddress },
        {
          $inc: { 
            totalStake: totalStake,
            transactionCount: activeTxs.length,
            activeStakes: activeTxs.length
          },
          $addToSet: { 
            finalityProviders: { $each: uniqueFPs }
          },
          $min: { firstSeen: Math.min(...timestamps) },
          $max: { lastSeen: Math.max(...timestamps) },
          $set: {
            transactions: transactions,
            phaseStakes: phaseStakes
          }
        },
        { upsert: true }
      );
    });

    await Promise.all([...fpUpdates, ...stakerUpdates]);
  }

  async getTransactionsByBlockRange(startHeight: number, endHeight: number): Promise<StakeTransaction[]> {
    try {
      return await Transaction.find({
        blockHeight: {
          $gte: startHeight,
          $lte: endHeight
        }
      }).sort({ blockHeight: 1 });
    } catch (error) {
      console.error('Error getting transactions by block range:', error);
      throw error;
    }
  }

  async getUniqueBlocks(finalityProvider: string): Promise<number[]> {
    return Transaction.distinct('blockHeight', { finalityProvider });
  }

  async getStakerTransactions(finalityProvider: string): Promise<StakeTransaction[]> {
    return Transaction.find(
      { finalityProvider },
      { stakerAddress: 1, timestamp: 1 }
    ).lean();
  }
}
