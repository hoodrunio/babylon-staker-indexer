import { Network } from '../../types/finality';
import { BBNTransaction, BBNAccount, BBNTransactionStats } from '../../database/models';
import { StatPeriodType } from '../../types/bbn';
import { logger } from '../../utils/logger';
import { CacheService } from '../CacheService';
import moment from 'moment';

export class BBNTransactionStatsService {
    private static instances: Map<Network, BBNTransactionStatsService> = new Map();
    private cacheService: CacheService;
    private readonly network: Network;
    private isCalculating: boolean = false;
    
    private constructor(network: Network = Network.TESTNET) {
        this.network = network;
        this.cacheService = CacheService.getInstance();
    }

    public static getInstance(network: Network = Network.TESTNET): BBNTransactionStatsService {
        if (!this.instances.has(network)) {
            this.instances.set(network, new BBNTransactionStatsService(network));
        }
        return this.instances.get(network)!;
    }

    /**
     * Calculates and updates daily transaction statistics
     */
    public async calculateDailyStats(targetDate: Date = new Date()): Promise<void> {
        if (this.isCalculating) {
            logger.warn('Stats calculation already in progress');
            return;
        }

        this.isCalculating = true;
        try {
            const startOfDay = moment(targetDate).startOf('day').valueOf();
            const endOfDay = moment(targetDate).endOf('day').valueOf();
            
            logger.info(`Calculating daily stats for ${moment(targetDate).format('YYYY-MM-DD')}`);
            
            // Calculate transaction statistics
            const [transactionCount, transactionVolume] = await this.getTransactionMetrics(startOfDay, endOfDay);
            
            // Calculate active accounts
            const activeAccounts = await this.getActiveAccounts(startOfDay, endOfDay);
            
            // Calculate transaction counts by type
            const transactionsByType = await this.getTransactionCountByType(startOfDay, endOfDay);
            
            // Calculate average fee
            const averageFee = await this.getAverageFee(startOfDay, endOfDay);
            
            // Create or update stats record
            await this.updateStats({
                date: moment(targetDate).startOf('day').toDate(),
                periodType: StatPeriodType.DAILY,
                networkType: this.network.toLowerCase() as 'mainnet' | 'testnet',
                totalTransactions: transactionCount,
                totalVolume: transactionVolume,
                activeAccounts,
                transactionsByType,
                averageFee
            });
            
            logger.info(`Daily stats calculated for ${moment(targetDate).format('YYYY-MM-DD')}`);
            
            // Update cache
            this.cacheService.set(
                `bbn_transaction_stats_daily_${this.network}_${moment(targetDate).format('YYYY-MM-DD')}`,
                { 
                    totalTransactions: transactionCount,
                    totalVolume: transactionVolume,
                    activeAccounts,
                    transactionsByType,
                    averageFee
                },
                60 * 60 * 24 // Cache for 24 hours
            );
        } catch (error) {
            logger.error('Error calculating daily stats:', error);
        } finally {
            this.isCalculating = false;
        }
    }

    /**
     * Calculates and updates weekly transaction statistics
     */
    public async calculateWeeklyStats(targetDate: Date = new Date()): Promise<void> {
        try {
            const startOfWeek = moment(targetDate).startOf('week').toDate();
            const endOfWeek = moment(targetDate).endOf('week').toDate();
            
            logger.info(`Calculating weekly stats for week of ${moment(startOfWeek).format('YYYY-MM-DD')}`);
            
            // Aggregate daily stats for the week
            const dailyStats = await BBNTransactionStats.find({
                periodType: StatPeriodType.DAILY,
                networkType: this.network.toLowerCase(),
                date: { 
                    $gte: startOfWeek,
                    $lte: endOfWeek
                }
            });
            
            if (dailyStats.length === 0) {
                logger.warn(`No daily stats found for week of ${moment(startOfWeek).format('YYYY-MM-DD')}`);
                return;
            }
            
            // Aggregate stats
            const totalTransactions = dailyStats.reduce((sum, stat) => sum + stat.totalTransactions, 0);
            const totalVolume = dailyStats.reduce((sum, stat) => sum + stat.totalVolume, 0);
            const maxActiveAccounts = Math.max(...dailyStats.map(stat => stat.activeAccounts));
            
            // Aggregate transactions by type
            const transactionsByType = {
                TRANSFER: 0,
                STAKE: 0,
                UNSTAKE: 0,
                REWARD: 0,
                OTHER: 0
            };
            
            dailyStats.forEach(stat => {
                transactionsByType.TRANSFER += stat.transactionsByType?.TRANSFER || 0;
                transactionsByType.STAKE += stat.transactionsByType?.STAKE || 0;
                transactionsByType.UNSTAKE += stat.transactionsByType?.UNSTAKE || 0;
                transactionsByType.REWARD += stat.transactionsByType?.REWARD || 0;
                transactionsByType.OTHER += stat.transactionsByType?.OTHER || 0;
            });
            
            // Calculate average fee
            const totalFees = dailyStats.reduce((sum, stat) => sum + (stat.averageFee * stat.totalTransactions), 0);
            const averageFee = totalTransactions > 0 ? totalFees / totalTransactions : 0;
            
            // Create or update weekly stats
            await this.updateStats({
                date: startOfWeek,
                periodType: StatPeriodType.WEEKLY,
                networkType: this.network.toLowerCase() as 'mainnet' | 'testnet',
                totalTransactions,
                totalVolume,
                activeAccounts: maxActiveAccounts,
                transactionsByType,
                averageFee
            });
            
            logger.info(`Weekly stats calculated for week of ${moment(startOfWeek).format('YYYY-MM-DD')}`);
            
            // Update cache
            this.cacheService.set(
                `bbn_transaction_stats_weekly_${this.network}_${moment(startOfWeek).format('YYYY-MM-DD')}`,
                { 
                    totalTransactions,
                    totalVolume,
                    activeAccounts: maxActiveAccounts,
                    transactionsByType,
                    averageFee
                },
                60 * 60 * 24 * 7 // Cache for 7 days
            );
        } catch (error) {
            logger.error('Error calculating weekly stats:', error);
        }
    }

    /**
     * Calculates and updates monthly transaction statistics
     */
    public async calculateMonthlyStats(targetDate: Date = new Date()): Promise<void> {
        try {
            const startOfMonth = moment(targetDate).startOf('month').toDate();
            const endOfMonth = moment(targetDate).endOf('month').toDate();
            
            logger.info(`Calculating monthly stats for ${moment(startOfMonth).format('YYYY-MM')}`);
            
            // Aggregate daily stats for the month
            const dailyStats = await BBNTransactionStats.find({
                periodType: StatPeriodType.DAILY,
                networkType: this.network.toLowerCase(),
                date: { 
                    $gte: startOfMonth,
                    $lte: endOfMonth
                }
            });
            
            if (dailyStats.length === 0) {
                logger.warn(`No daily stats found for month of ${moment(startOfMonth).format('YYYY-MM')}`);
                return;
            }
            
            // Aggregate stats
            const totalTransactions = dailyStats.reduce((sum, stat) => sum + stat.totalTransactions, 0);
            const totalVolume = dailyStats.reduce((sum, stat) => sum + stat.totalVolume, 0);
            const maxActiveAccounts = Math.max(...dailyStats.map(stat => stat.activeAccounts));
            
            // Aggregate transactions by type
            const transactionsByType = {
                TRANSFER: 0,
                STAKE: 0,
                UNSTAKE: 0,
                REWARD: 0,
                OTHER: 0
            };
            
            dailyStats.forEach(stat => {
                transactionsByType.TRANSFER += stat.transactionsByType?.TRANSFER || 0;
                transactionsByType.STAKE += stat.transactionsByType?.STAKE || 0;
                transactionsByType.UNSTAKE += stat.transactionsByType?.UNSTAKE || 0;
                transactionsByType.REWARD += stat.transactionsByType?.REWARD || 0;
                transactionsByType.OTHER += stat.transactionsByType?.OTHER || 0;
            });
            
            // Calculate average fee
            const totalFees = dailyStats.reduce((sum, stat) => sum + (stat.averageFee * stat.totalTransactions), 0);
            const averageFee = totalTransactions > 0 ? totalFees / totalTransactions : 0;
            
            // Create or update monthly stats
            await this.updateStats({
                date: startOfMonth,
                periodType: StatPeriodType.MONTHLY,
                networkType: this.network.toLowerCase() as 'mainnet' | 'testnet',
                totalTransactions,
                totalVolume,
                activeAccounts: maxActiveAccounts,
                transactionsByType,
                averageFee
            });
            
            logger.info(`Monthly stats calculated for month of ${moment(startOfMonth).format('YYYY-MM')}`);
            
            // Update cache
            this.cacheService.set(
                `bbn_transaction_stats_monthly_${this.network}_${moment(startOfMonth).format('YYYY-MM')}`,
                { 
                    totalTransactions,
                    totalVolume,
                    activeAccounts: maxActiveAccounts,
                    transactionsByType,
                    averageFee
                },
                60 * 60 * 24 * 30 // Cache for 30 days
            );
        } catch (error) {
            logger.error('Error calculating monthly stats:', error);
        }
    }

    /**
     * Calculates and updates all-time transaction statistics
     */
    public async calculateAllTimeStats(): Promise<void> {
        try {
            logger.info(`Calculating all-time stats for ${this.network}`);
            
            // Get first transaction timestamp
            const firstTransaction = await BBNTransaction.findOne({
                networkType: this.network.toLowerCase()
            }).sort({ timestamp: 1 });
            
            if (!firstTransaction) {
                logger.warn(`No transactions found for ${this.network}`);
                return;
            }
            
            const startDate = new Date(firstTransaction.timestamp);
            const endDate = new Date();
            
            // Calculate transaction statistics
            const [totalTransactions, totalVolume] = await this.getTransactionMetrics(startDate.getTime(), endDate.getTime());
            
            // Count all accounts that have had at least one transaction
            const totalAccounts = await BBNAccount.countDocuments({
                networkType: this.network.toLowerCase()
            });
            
            // Calculate transaction counts by type
            const transactionsByType = await this.getTransactionCountByType(startDate.getTime(), endDate.getTime());
            
            // Calculate average fee across all transactions
            const averageFee = await this.getAverageFee(startDate.getTime(), endDate.getTime());
            
            // Create or update all-time stats
            await this.updateStats({
                date: startDate, // Using first transaction date as reference
                periodType: StatPeriodType.ALL_TIME,
                networkType: this.network.toLowerCase() as 'mainnet' | 'testnet',
                totalTransactions,
                totalVolume,
                activeAccounts: totalAccounts,
                transactionsByType,
                averageFee
            });
            
            logger.info(`All-time stats calculated for ${this.network}`);
            
            // Update cache
            this.cacheService.set(
                `bbn_transaction_stats_all_time_${this.network}`,
                { 
                    totalTransactions,
                    totalVolume,
                    activeAccounts: totalAccounts,
                    transactionsByType,
                    averageFee,
                    firstTransactionDate: startDate
                },
                60 * 60 * 24 // Cache for 24 hours
            );
        } catch (error) {
            logger.error('Error calculating all-time stats:', error);
        }
    }

    /**
     * Gets transaction metrics (count and volume) for a time period
     */
    private async getTransactionMetrics(startTime: number, endTime: number): Promise<[number, number]> {
        try {
            const transactions = await BBNTransaction.find({
                timestamp: { $gte: startTime, $lte: endTime },
                networkType: this.network.toLowerCase()
            });
            
            const count = transactions.length;
            const volume = transactions.reduce((sum, tx) => sum + tx.amount, 0);
            
            return [count, volume];
        } catch (error) {
            logger.error('Error getting transaction metrics:', error);
            return [0, 0];
        }
    }

    /**
     * Gets active accounts count for a time period
     */
    private async getActiveAccounts(startTime: number, endTime: number): Promise<number> {
        try {
            // Count unique accounts that had activity in the time period
            const uniqueAccounts = await BBNTransaction.aggregate([
                {
                    $match: {
                        timestamp: { $gte: startTime, $lte: endTime },
                        networkType: this.network.toLowerCase()
                    }
                },
                {
                    $group: {
                        _id: null,
                        senders: { $addToSet: '$sender' },
                        receivers: { $addToSet: '$receiver' }
                    }
                },
                {
                    $project: {
                        allAddresses: { $setUnion: ['$senders', '$receivers'] }
                    }
                },
                {
                    $project: {
                        count: { $size: '$allAddresses' }
                    }
                }
            ]);
            
            return uniqueAccounts.length > 0 ? uniqueAccounts[0].count : 0;
        } catch (error) {
            logger.error('Error getting active accounts:', error);
            return 0;
        }
    }

    /**
     * Gets transaction counts by type for a time period
     */
    private async getTransactionCountByType(startTime: number, endTime: number): Promise<{
        TRANSFER: number;
        STAKE: number;
        UNSTAKE: number;
        REWARD: number;
        OTHER: number;
    }> {
        try {
            const typeStats = await BBNTransaction.aggregate([
                {
                    $match: {
                        timestamp: { $gte: startTime, $lte: endTime },
                        networkType: this.network.toLowerCase()
                    }
                },
                {
                    $group: {
                        _id: '$type',
                        count: { $sum: 1 }
                    }
                }
            ]);
            
            const result = {
                TRANSFER: 0,
                STAKE: 0,
                UNSTAKE: 0,
                REWARD: 0,
                OTHER: 0
            };
            
            typeStats.forEach(stat => {
                result[stat._id as keyof typeof result] = stat.count;
            });
            
            return result;
        } catch (error) {
            logger.error('Error getting transaction counts by type:', error);
            return {
                TRANSFER: 0,
                STAKE: 0,
                UNSTAKE: 0,
                REWARD: 0,
                OTHER: 0
            };
        }
    }

    /**
     * Gets average fee for a time period
     */
    private async getAverageFee(startTime: number, endTime: number): Promise<number> {
        try {
            const result = await BBNTransaction.aggregate([
                {
                    $match: {
                        timestamp: { $gte: startTime, $lte: endTime },
                        networkType: this.network.toLowerCase()
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalFees: { $sum: '$fee' },
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        averageFee: { $divide: ['$totalFees', '$count'] }
                    }
                }
            ]);
            
            return result.length > 0 ? result[0].averageFee : 0;
        } catch (error) {
            logger.error('Error getting average fee:', error);
            return 0;
        }
    }

    /**
     * Creates or updates a stats record
     */
    private async updateStats(data: {
        date: Date;
        periodType: StatPeriodType;
        networkType: 'mainnet' | 'testnet';
        totalTransactions: number;
        totalVolume: number;
        activeAccounts: number;
        transactionsByType: {
            TRANSFER: number;
            STAKE: number;
            UNSTAKE: number;
            REWARD: number;
            OTHER: number;
        };
        averageFee: number;
    }): Promise<void> {
        try {
            const query = {
                date: data.date,
                periodType: data.periodType,
                networkType: data.networkType
            };
            
            const update = {
                $set: {
                    totalTransactions: data.totalTransactions,
                    totalVolume: data.totalVolume,
                    activeAccounts: data.activeAccounts,
                    transactionsByType: data.transactionsByType,
                    averageFee: data.averageFee,
                    lastUpdated: new Date()
                }
            };
            
            await BBNTransactionStats.updateOne(query, update, { upsert: true });
        } catch (error) {
            logger.error('Error updating stats:', error);
            throw error;
        }
    }

    /**
     * Gets stats from the database
     */
    public async getStats(periodType: StatPeriodType, date?: Date): Promise<any> {
        try {
            let query: any = {
                periodType,
                networkType: this.network.toLowerCase()
            };
            
            // Add date filter for specific periods
            if (date && periodType !== StatPeriodType.ALL_TIME) {
                if (periodType === StatPeriodType.DAILY) {
                    query.date = moment(date).startOf('day').toDate();
                } else if (periodType === StatPeriodType.WEEKLY) {
                    query.date = moment(date).startOf('week').toDate();
                } else if (periodType === StatPeriodType.MONTHLY) {
                    query.date = moment(date).startOf('month').toDate();
                }
            }
            
            // Check cache first
            let cacheKey = '';
            if (periodType === StatPeriodType.DAILY && date) {
                cacheKey = `bbn_transaction_stats_daily_${this.network}_${moment(date).format('YYYY-MM-DD')}`;
            } else if (periodType === StatPeriodType.WEEKLY && date) {
                cacheKey = `bbn_transaction_stats_weekly_${this.network}_${moment(date).startOf('week').format('YYYY-MM-DD')}`;
            } else if (periodType === StatPeriodType.MONTHLY && date) {
                cacheKey = `bbn_transaction_stats_monthly_${this.network}_${moment(date).format('YYYY-MM')}`;
            } else if (periodType === StatPeriodType.ALL_TIME) {
                cacheKey = `bbn_transaction_stats_all_time_${this.network}`;
            }
            
            if (cacheKey) {
                const cachedStats = this.cacheService.get(cacheKey);
                if (cachedStats) {
                    return cachedStats;
                }
            }
            
            // Get from database if not in cache
            const stats = await BBNTransactionStats.findOne(query).sort({ date: -1 });
            
            if (!stats && periodType !== StatPeriodType.ALL_TIME) {
                // If stats don't exist yet, calculate them
                if (periodType === StatPeriodType.DAILY) {
                    await this.calculateDailyStats(date || new Date());
                } else if (periodType === StatPeriodType.WEEKLY) {
                    await this.calculateWeeklyStats(date || new Date());
                } else if (periodType === StatPeriodType.MONTHLY) {
                    await this.calculateMonthlyStats(date || new Date());
                }
                
                // Try to get the newly calculated stats
                return await BBNTransactionStats.findOne(query);
            } else if (!stats && periodType === StatPeriodType.ALL_TIME) {
                await this.calculateAllTimeStats();
                return await BBNTransactionStats.findOne(query);
            }
            
            return stats;
        } catch (error) {
            logger.error('Error getting stats:', error);
            throw error;
        }
    }
} 