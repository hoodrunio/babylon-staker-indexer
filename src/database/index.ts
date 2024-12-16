import mongoose from 'mongoose';
import { Transaction } from './models/Transaction';
import { FinalityProvider } from './models/FinalityProvider';
import { Staker } from './models/Staker';
import { StakeTransaction, TimeRange, FinalityProviderStats, StakerStats, VersionStats, TopFinalityProviderStats } from '../types';
import dotenv from 'dotenv';
import { IndexerState } from './models/IndexerState';
import { PhaseStats } from './models/phase-stats';

dotenv.config();

interface QueryWithTimestamp {
  address: string;
  timestamp?: {
    $gte: number;
    $lte: number;
  };
}

export class Database {
  private static instance: Database | null = null;
  private isConnected: boolean = false;

  constructor() {
    // Constructor is now public but we still maintain singleton through getInstance
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    try {
      await mongoose.connect(process.env.MONGODB_URI!);
      this.isConnected = true;
      if (process.env.LOG_LEVEL === 'debug') {
        console.log('Connected to MongoDB successfully');
      }
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  }

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

        // Update Staker stats - Create a new staker if it doesn't exist
        Staker.findOneAndUpdate(
          { address: tx.stakerAddress },
          {
            address: tx.stakerAddress, // Explicitly set the address
            $inc: { 
              totalStake: tx.stakeAmount,
              transactionCount: 1,
              activeStakes: 1
            },
            $addToSet: { finalityProviders: tx.finalityProvider },
            $min: { firstSeen: tx.timestamp },
            $max: { lastSeen: tx.timestamp },
            $setOnInsert: {
              uniqueStakers: [], // Initialize empty array for new stakers
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

    // Get unique blocks
    const uniqueBlocks = await Transaction.distinct('blockHeight', {
      finalityProvider: address,
      ...(timeRange && {
        timestamp: {
          $gte: timeRange.firstTimestamp,
          $lte: timeRange.lastTimestamp
        }
      })
    });

    // Get staker addresses with their latest transactions
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

    // Get unique staker addresses
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
      stakerAddresses
    };
  }

  async getAllFPs(): Promise<FinalityProviderStats[]> {
    const fps = await FinalityProvider.find();
    
    return Promise.all(fps.map(async (fp) => {
      const uniqueBlocks = await Transaction.distinct('blockHeight', {
        finalityProvider: fp.address
      });

      // Get staker addresses
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
        stakerAddresses
      };
    }));
  }

  async getTopFPs(limit: number = 10): Promise<TopFinalityProviderStats[]> {
    const fps = await FinalityProvider.find()
      .sort({ totalStake: -1 })
      .limit(limit);

    // Toplam stake miktarını hesapla
    const totalStake = await FinalityProvider.aggregate([
      { $group: { _id: null, total: { $sum: '$totalStake' } } }
    ]);
    const totalStakeAmount = totalStake[0]?.total || 0;

    const results = await Promise.all(fps.map(async (fp, index) => {
      const uniqueBlocks = await Transaction.distinct('blockHeight', {
        finalityProvider: fp.address
      });

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
        stakerAddresses: [],
        averageStakeBTC: (fp.totalStake / fp.transactionCount) / 100000000,
        versionsUsed: fp.versionsUsed,
        rank: index + 1,
        stakingShare: (fp.totalStake / totalStakeAmount) * 100
      };
    }));

    return results;
  }

  async getStakerStats(address: string, timeRange?: TimeRange): Promise<StakerStats> {
    try {
      console.log('Searching for staker:', address);
      console.log('Time range:', timeRange);

      // Önce staker'ı bul
      const staker = await Staker.findOne({ address });
      if (!staker) {
        throw new Error(`Staker not found: ${address}`);
      }

      // TimeRange varsa geçerli olduğunu kontrol et
      if (timeRange) {
        if (isNaN(timeRange.firstTimestamp) || isNaN(timeRange.lastTimestamp)) {
          throw new Error('Invalid time range parameters');
        }
      }

      // Blok sayısını hesapla
      const uniqueBlocks = await Transaction.distinct('blockHeight', {
        stakerAddress: address,
        ...(timeRange && {
          timestamp: {
            $gte: timeRange.firstTimestamp,
            $lte: timeRange.lastTimestamp
          }
        })
      });

      return {
        totalStakeBTC: staker.totalStake / 100000000,
        transactionCount: staker.transactionCount,
        uniqueStakers: staker.uniqueStakers?.length || 0,
        uniqueBlocks: uniqueBlocks.length,
        timeRange: timeRange || {
          firstTimestamp: staker.firstSeen,
          lastTimestamp: staker.lastSeen,
          durationSeconds: staker.lastSeen - staker.firstSeen
        },
        finalityProviders: staker.finalityProviders,
        activeStakes: staker.activeStakes
      };
    } catch (error) {
      console.error('Error in getStakerStats:', error);
      throw error;
    }
  }

  async getTopStakers(limit: number = 10): Promise<StakerStats[]> {
    const stakers = await Staker.find()
      .sort({ totalStake: -1 })
      .limit(limit);

    const results = await Promise.all(stakers.map(async (staker) => {
      const uniqueBlocks = await Transaction.distinct('blockHeight', {
        stakerAddress: staker.address
      });

      return {
        totalStakeBTC: staker.totalStake / 100000000,
        transactionCount: staker.transactionCount,
        uniqueStakers: staker.uniqueStakers?.length || 0,
        uniqueBlocks: uniqueBlocks.length,
        timeRange: {
          firstTimestamp: staker.firstSeen,
          lastTimestamp: staker.lastSeen,
          durationSeconds: staker.lastSeen - staker.firstSeen
        },
        finalityProviders: staker.finalityProviders,
        activeStakes: staker.activeStakes
      };
    }));

    return results;
  }

  async getVersionStats(version: number, timeRange?: TimeRange): Promise<VersionStats> {
    const matchStage: any = { version };
    if (timeRange) {
      matchStage.timestamp = {
        $gte: timeRange.firstTimestamp,
        $lte: timeRange.lastTimestamp
      };
    }

    const [stats] = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$version',
          transactionCount: { $sum: 1 },
          totalStake: { $sum: '$stakeAmount' },
          uniqueStakers: { $addToSet: '$stakerAddress' },
          uniqueFPs: { $addToSet: '$finalityProvider' },
          uniqueBlocks: { $addToSet: '$blockHeight' },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' }
        }
      },
      {
        $project: {
          _id: 1,
          version: 1,
          totalStake: 1,
          totalTransactions: 1,
          uniqueStakers: 1,
          timeRange: {
            firstTimestamp: '$firstSeen',
            lastTimestamp: '$lastSeen',
            durationSeconds: {
              $subtract: [
                '$lastSeen',
                '$firstSeen'
              ]
            }
          }
        }
      }
    ]);

    return stats || {
      version,
      transactionCount: 0,
      totalStakeBTC: 0,
      uniqueStakers: 0,
      uniqueFPs: 0,
      uniqueBlocks: 0,
      timeRange: {
        firstTimestamp: 0,
        lastTimestamp: 0,
        durationSeconds: 0
      }
    };
  }

  async getGlobalStats(): Promise<{
    totalStakeBTC: number;
    uniqueStakers: number;
    totalTransactions: number;
    uniqueFPs: number;
    uniqueBlocks: number;
    timeRange: TimeRange;
  }> {
    const [stats] = await Transaction.aggregate([
      {
        $facet: {
          stats: [
            {
              $group: {
                _id: null,
                totalStake: { $sum: '$stakeAmount' },
                uniqueStakers: { $addToSet: '$stakerAddress' },
                uniqueFPs: { $addToSet: '$finalityProvider' },
                uniqueBlocks: { $addToSet: '$blockHeight' },
                firstSeen: { $min: '$timestamp' },
                lastSeen: { $max: '$timestamp' }
              }
            }
          ],
          totalCount: [
            { $count: 'count' }
          ]
        }
      },
      {
        $project: {
          _id: 0,
          totalStakeBTC: {
            $cond: {
              if: { $gt: [{ $size: '$stats' }, 0] },
              then: { $divide: [{ $first: '$stats.totalStake' }, 100000000] },
              else: 0
            }
          },
          uniqueStakers: {
            $cond: {
              if: { $gt: [{ $size: '$stats' }, 0] },
              then: { $size: { $first: '$stats.uniqueStakers' } },
              else: 0
            }
          },
          totalTransactions: {
            $cond: {
              if: { $gt: [{ $size: '$totalCount' }, 0] },
              then: { $first: '$totalCount.count' },
              else: 0
            }
          },
          uniqueFPs: {
            $cond: {
              if: { $gt: [{ $size: '$stats' }, 0] },
              then: { $size: { $first: '$stats.uniqueFPs' } },
              else: 0
            }
          },
          uniqueBlocks: {
            $cond: {
              if: { $gt: [{ $size: '$stats' }, 0] },
              then: { $size: { $first: '$stats.uniqueBlocks' } },
              else: 0
            }
          },
          timeRange: {
            $cond: {
              if: { $gt: [{ $size: '$stats' }, 0] },
              then: {
                firstTimestamp: { $first: '$stats.firstSeen' },
                lastTimestamp: { $first: '$stats.lastSeen' },
                durationSeconds: {
                  $subtract: [
                    { $first: '$stats.lastSeen' },
                    { $first: '$stats.firstSeen' }
                  ]
                }
              },
              else: {
                firstTimestamp: 0,
                lastTimestamp: 0,
                durationSeconds: 0
              }
            }
          }
        }
      }
    ]);

    return stats || {
      totalStakeBTC: 0,
      uniqueStakers: 0,
      totalTransactions: 0,
      uniqueFPs: 0,
      uniqueBlocks: 0,
      timeRange: {
        firstTimestamp: 0,
        lastTimestamp: 0,
        durationSeconds: 0
      }
    };
  }

  async getLastProcessedBlock(): Promise<number> {
    const state = await IndexerState.findOne();
    return state?.lastProcessedBlock || 0;
  }

  async updateLastProcessedBlock(height: number): Promise<void> {
    await IndexerState.findOneAndUpdate(
      {},
      { lastProcessedBlock: height },
      { upsert: true }
    );
  }

  async reindexStakers(): Promise<void> {
    try {
      console.log('Starting staker reindexing...');
      
      // Get all transactions
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
    
    // Exact match search
    const exactMatch = await Staker.findOne({ address });
    console.log('Exact match:', exactMatch?.address);

    // Case-insensitive search
    const caseInsensitive = await Staker.findOne({ 
      address: { $regex: new RegExp('^' + address + '$', 'i') } 
    });
    console.log('Case-insensitive match:', caseInsensitive?.address);

    // Similar addresses
    const similar = await Staker.find({ 
      address: { $regex: new RegExp(address.substring(0, 10), 'i') }
    });
    console.log('Similar addresses:', similar.map(s => s.address));

    // Check if address exists in transactions
    const transaction = await Transaction.findOne({ stakerAddress: address });
    console.log('Found in transactions:', transaction?.stakerAddress);
  }

  async getTransactionsByBlockRange(startHeight: number, endHeight: number): Promise<StakeTransaction[]> {
    try {
      const transactions = await Transaction.find({
        blockHeight: {
          $gte: startHeight,
          $lte: endHeight
        }
      }).sort({ blockHeight: 1 });
      
      return transactions;
    } catch (error) {
      console.error('Error getting transactions by block range:', error);
      throw error;
    }
  }

  async initPhaseStats(phase: number, startHeight: number): Promise<void> {
    try {
      // Use findOneAndUpdate with upsert to handle both creation and update
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
      console.error('Error initializing phase stats:', error);
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
        // Convert stake amount to BTC with high precision
        const stakeBTC = Number((transaction.stakeAmount / 100000000).toFixed(8));
        
        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`Updating phase ${phase} stats:`);
          console.log(`Adding stake amount: ${transaction.stakeAmount} satoshi (${stakeBTC} BTC)`);
          console.log(`Current total stake: ${stats.totalStakeBTC} BTC`);
        }

        // Use atomic updates to prevent race conditions
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

        // Update unique stakers in a separate operation
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
          console.log(`New total stake: ${updatedStats?.totalStakeBTC} BTC`);
        }
      } else {
        // If no transaction, just update height and timestamp
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
      console.error('Error updating phase stats:', error);
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
      console.error('Error completing phase:', error);
      throw error;
    }
  }

  async getPhaseStats(phase: number): Promise<any> {
    try {
      const stats = await PhaseStats.findOne({ phase }).lean();
      if (!stats) {
        throw new Error(`Phase ${phase} not found`);
      }
      return stats;
    } catch (error) {
      console.error('Error getting phase stats:', error);
      throw error;
    }
  }

  async getAllPhaseStats(): Promise<any[]> {
    try {
      const stats = await PhaseStats.find().sort({ phase: 1 }).lean();
      return stats;
    } catch (error) {
      console.error('Error getting all phase stats:', error);
      throw error;
    }
  }
}