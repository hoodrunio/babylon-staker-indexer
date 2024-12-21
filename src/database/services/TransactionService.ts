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

      // Save transaction and update stats
      await Promise.all([
        // Save transaction
        Transaction.create(tx),

        // Update FP stats
        FinalityProvider.findOneAndUpdate(
          { address: tx.finalityProvider },
          {
            $inc: { 
              totalStake: tx.stakeAmount,
              transactionCount: 1
            },
            $addToSet: { 
              uniqueStakers: tx.stakerAddress,
              versionsUsed: tx.version
            },
            $min: { firstSeen: tx.timestamp },
            $max: { lastSeen: tx.timestamp }
          },
          { upsert: true, new: true }
        ),

        // Update Staker stats
        Staker.findOneAndUpdate(
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
            $max: { lastSeen: tx.timestamp },
            $setOnInsert: {
              uniqueStakers: [],
            }
          },
          { 
            upsert: true, 
            new: true,
            setDefaultsOnInsert: true
          }
        )
      ]);

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

      await FinalityProvider.updateOne(
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
          $max: { lastSeen: Math.max(...timestamps) }
        },
        { upsert: true }
      );
    });

    const stakerUpdates = Array.from(stakerTransactions.entries()).map(async ([stakerAddress, txs]) => {
      const activeTxs = txs.filter(tx => !tx.isOverflow);
      const totalStake = activeTxs.reduce((sum, tx) => sum + tx.stakeAmount, 0);
      const uniqueFPs = [...new Set(activeTxs.map(tx => tx.finalityProvider))];
      const timestamps = activeTxs.map(tx => tx.timestamp);

      await Staker.updateOne(
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
          $max: { lastSeen: Math.max(...timestamps) }
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
}
