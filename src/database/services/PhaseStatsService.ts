import { PhaseStats } from '../models/phase-stats';
import { Transaction } from '../models/Transaction';
import { StakeTransaction } from '../../types';
import { logger } from '../../utils/logger';
export class PhaseStatsService {
  async initPhaseStats(phase: number, startHeight: number): Promise<void> {
    try {
      await PhaseStats.findOneAndUpdate(
        { phase },
        {
          phase,
          startHeight,
          currentHeight: startHeight,
          totalStakeBTC: 0,
          totalTransactions: 0,
          uniqueStakers: 0,
          lastStakeHeight: startHeight,
          lastUpdateTime: new Date(),
          status: 'active'
        },
        {
          upsert: true,
          setDefaultsOnInsert: true
        }
      );
    } catch (error) {
      logger.error('Error initializing phase stats:', error);
      throw error;
    }
  }

  async updatePhaseStats(phase: number, height: number, transaction?: StakeTransaction): Promise<void> {
    try {
      const stats = await PhaseStats.findOne({ phase });
      if (!stats) {
        throw new Error(`Phase ${phase} stats not found`);
      }

      if (transaction) {
        const stakeBTC = Number((transaction.stakeAmount / 100000000).toFixed(8));
        
        if (process.env.LOG_LEVEL === 'debug') {
          logger.info(`Updating phase ${phase} stats:`);
          logger.info(`Adding stake amount: ${transaction.stakeAmount} satoshi (${stakeBTC} BTC)`);
          logger.info(`Current total stake: ${stats.totalStakeBTC} BTC`);
        }

        await PhaseStats.updateOne(
          { phase },
          {
            $inc: {
              totalStakeBTC: stakeBTC,
              totalTransactions: 1
            },
            $set: {
              currentHeight: height,
              lastStakeHeight: height,
              lastUpdateTime: new Date()
            }
          }
        );

        const uniqueStakers = await Transaction.distinct('stakerAddress', {
          blockHeight: { $gte: stats.startHeight, $lte: height }
        });

        await PhaseStats.updateOne(
          { phase },
          {
            $set: {
              uniqueStakers: uniqueStakers.length
            }
          }
        );

        if (process.env.LOG_LEVEL === 'debug') {
          const updatedStats = await PhaseStats.findOne({ phase });
          logger.info(`New total stake: ${updatedStats?.totalStakeBTC} BTC`);
        }
      } else {
        await PhaseStats.updateOne(
          { phase },
          {
            $set: {
              currentHeight: height,
              lastUpdateTime: new Date()
            }
          }
        );
      }
    } catch (error) {
      logger.error('Error updating phase stats:', error);
      throw error;
    }
  }

  async updatePhaseStatsBatch(phase: number, height: number, transactions: StakeTransaction[]): Promise<void> {
    try {
      const stats = await PhaseStats.findOne({ phase });
      if (!stats) {
        throw new Error(`Phase ${phase} stats not found`);
      }

      transactions.sort((a, b) => a.timestamp - b.timestamp);

      let currentActiveBTC = stats.activeStakeBTC;
      const processedTxs: Array<StakeTransaction & { isOverflow: boolean }> = [];

      for (const tx of transactions) {
        const txAmountBTC = Number((tx.stakeAmount / 100000000).toFixed(8));

        const isOverflow = phase === 1 ? 
          currentActiveBTC + txAmountBTC > 1000 : 
          tx.isOverflow;
        
        processedTxs.push({
          ...tx,
          isOverflow
        });

        if (!isOverflow) {
          currentActiveBTC += txAmountBTC;
        }
      }

      const activeTransactions = processedTxs.filter(tx => !tx.isOverflow);
      const overflowTransactions = processedTxs.filter(tx => tx.isOverflow);

      const activeStakeBTC = activeTransactions.reduce((sum, tx) => 
        sum + Number((tx.stakeAmount / 100000000).toFixed(8)), 0);
      
      const overflowStakeBTC = overflowTransactions.reduce((sum, tx) => 
        sum + Number((tx.stakeAmount / 100000000).toFixed(8)), 0);

      if (phase === 1 && stats.activeStakeBTC + activeStakeBTC > 1000) {
        logger.error('ERROR: Would exceed staking cap! Marking all transactions as overflow');
        processedTxs.forEach(tx => tx.isOverflow = true);
        
        await Promise.all(processedTxs.map(tx => 
          Transaction.updateOne(
            { txid: tx.txid },
            { $set: { isOverflow: true, overflowAmount: tx.stakeAmount } }
          )
        ));

        await PhaseStats.updateOne(
          { phase },
          {
            $inc: {
              totalStakeBTC: overflowStakeBTC,
              totalTransactions: transactions.length,
              overflowStakeBTC: overflowStakeBTC,
              overflowTransactions: overflowTransactions.length
            },
            $set: {
              currentHeight: height,
              lastStakeHeight: height,
              lastUpdateTime: new Date()
            }
          }
        );
      } else {
        await Promise.all(processedTxs.map(tx => 
          Transaction.updateOne(
            { txid: tx.txid },
            { 
              $set: { 
                isOverflow: tx.isOverflow,
                overflowAmount: tx.isOverflow ? tx.stakeAmount : 0
              } 
            }
          )
        ));

        await PhaseStats.updateOne(
          { phase },
          {
            $inc: {
              totalStakeBTC: activeStakeBTC + overflowStakeBTC,
              totalTransactions: transactions.length,
              activeStakeBTC: activeStakeBTC,
              activeTransactions: activeTransactions.length,
              overflowStakeBTC: overflowStakeBTC,
              overflowTransactions: overflowTransactions.length
            },
            $set: {
              currentHeight: height,
              lastStakeHeight: height,
              lastUpdateTime: new Date()
            }
          }
        );
      }

      const uniqueStakers = await Transaction.distinct('stakerAddress', {
        blockHeight: { $gte: stats.startHeight, $lte: height }
      });

      await PhaseStats.updateOne(
        { phase },
        {
          $set: {
            uniqueStakers: uniqueStakers.length
          }
        }
      );

      if (process.env.LOG_LEVEL === 'debug') {
        const updatedStats = await PhaseStats.findOne({ phase });
        logger.info(`Phase ${phase} stats updated:`, {
          height,
          totalTransactions: transactions.length,
          activeTransactions: activeTransactions.length,
          overflowTransactions: overflowTransactions.length,
          activeStakeBTC,
          overflowStakeBTC,
          currentTotal: updatedStats?.activeStakeBTC
        });
      }
    } catch (error) {
      logger.error('Error updating phase stats:', error);
      throw error;
    }
  }

  async completePhase(phase: number, height: number, reason: 'target_reached' | 'timeout' | 'inactivity' | 'block_height'): Promise<void> {
    try {
      await PhaseStats.updateOne(
        { phase },
        {
          $set: {
            status: 'completed',
            endHeight: height,
            completionReason: reason,
            lastUpdateTime: new Date()
          }
        }
      );
    } catch (error) {
      logger.error('Error completing phase:', error);
      throw error;
    }
  }

  async getPhaseStats(phase: number): Promise<PhaseStats | null> {
    try {
      let stats = await PhaseStats.findOne({ phase });
      
      if (!stats) {
        const { getPhaseConfig } = await import('../../config/phase-config');
        const phaseConfig = getPhaseConfig();
        const phaseInfo = phaseConfig.phases.find(p => p.phase === phase);
        
        const startHeight = phaseInfo ? 
          parseInt(process.env[`PHASE${phase}_START_HEIGHT`] || phaseInfo.startHeight.toString()) :
          parseInt(process.env[`PHASE${phase}_START_HEIGHT`] || '0');

        const currentTime = new Date();
        
        stats = await PhaseStats.create({
          phase,
          totalStakeBTC: 0,
          activeStakeBTC: 0,
          overflowStakeBTC: 0,
          uniqueStakers: 0,
          transactionCount: 0,
          firstBlock: startHeight,
          lastBlock: startHeight,
          startTime: currentTime,
          endTime: currentTime,
          status: 'active',
          startHeight: startHeight,
          currentHeight: startHeight,
          lastStakeHeight: startHeight,
          lastUpdateTime: currentTime
        });
      }
      
      return stats;
    } catch (error) {
      logger.error('Error getting phase stats:', error);
      return null;
    }
  }

  async getAllPhaseStats(): Promise<any[]> {
    try {
      return await PhaseStats.find().sort({ phase: 1 }).lean();
    } catch (error) {
      logger.error('Error getting all phase stats:', error);
      throw error;
    }
  }
}
