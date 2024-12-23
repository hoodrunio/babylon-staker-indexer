import { Transaction } from '../models/Transaction';
import { TimeRange, VersionStats } from '../../types';

export class StatsService {
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
    activeStakeBTC: number;
    activeTransactions: number;
    overflowStakeBTC: number;
    overflowTransactions: number;
  }> {
    const [stats] = await Transaction.aggregate([
      {
        $facet: {
          stats: [
            {
              $group: {
                _id: null,
                totalStake: { $sum: '$stakeAmount' },
                activeStake: {
                  $sum: {
                    $cond: [
                      { $eq: ['$isOverflow', false] },
                      '$stakeAmount',
                      0
                    ]
                  }
                },
                overflowStake: {
                  $sum: {
                    $cond: [
                      { $eq: ['$isOverflow', true] },
                      '$stakeAmount',
                      0
                    ]
                  }
                },
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
          ],
          activeCount: [
            {
              $match: { isOverflow: false }
            },
            { $count: 'count' }
          ],
          overflowCount: [
            {
              $match: { isOverflow: true }
            },
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
          activeStakeBTC: {
            $cond: {
              if: { $gt: [{ $size: '$stats' }, 0] },
              then: { $divide: [{ $first: '$stats.activeStake' }, 100000000] },
              else: 0
            }
          },
          overflowStakeBTC: {
            $cond: {
              if: { $gt: [{ $size: '$stats' }, 0] },
              then: { $divide: [{ $first: '$stats.overflowStake' }, 100000000] },
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
          activeTransactions: {
            $cond: {
              if: { $gt: [{ $size: '$activeCount' }, 0] },
              then: { $first: '$activeCount.count' },
              else: 0
            }
          },
          overflowTransactions: {
            $cond: {
              if: { $gt: [{ $size: '$overflowCount' }, 0] },
              then: { $first: '$overflowCount.count' },
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
      activeStakeBTC: 0,
      overflowStakeBTC: 0,
      uniqueStakers: 0,
      totalTransactions: 0,
      activeTransactions: 0,
      overflowTransactions: 0,
      uniqueFPs: 0,
      uniqueBlocks: 0,
      timeRange: {
        firstTimestamp: 0,
        lastTimestamp: 0,
        durationSeconds: 0
      }
    };
  }
}
