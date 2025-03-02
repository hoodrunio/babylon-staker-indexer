import { Network } from '../../types/finality';
import { CacheService } from '../CacheService';
import { BBNStake, BBNStakeStats } from '../../database/models';
import { StatPeriodType, BBNStakeStatus } from '../../types/bbn';
import { logger } from '../../utils/logger';
import moment from 'moment';

export class BBNStakeStatsService {
    private static instances: Map<Network, BBNStakeStatsService> = new Map();
    private cacheService: CacheService;
    private readonly network: Network;
    private isCalculating: boolean = false;
    
    private constructor(network: Network = Network.TESTNET) {
        this.network = network;
        this.cacheService = CacheService.getInstance();
    }

    public static getInstance(network: Network = Network.TESTNET): BBNStakeStatsService {
        if (!this.instances.has(network)) {
            this.instances.set(network, new BBNStakeStatsService(network));
        }
        return this.instances.get(network)!;
    }

    /**
     * Calculates and updates daily stake statistics
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
            
            logger.info(`Calculating daily stake stats for ${moment(targetDate).format('YYYY-MM-DD')}`);
            
            // Get total stakes count (all statuses)
            const totalStakes = await BBNStake.countDocuments({
                networkType: this.network.toLowerCase()
            });
            
            // Get active stakes
            const activeStakes = await BBNStake.countDocuments({
                networkType: this.network.toLowerCase(),
                status: BBNStakeStatus.ACTIVE
            });
            
            // Get new stakes created today
            const newStakes = await BBNStake.countDocuments({
                networkType: this.network.toLowerCase(),
                startTimestamp: { $gte: startOfDay, $lte: endOfDay }
            });
            
            // Get stakes unbonded today
            const unbondedStakes = await BBNStake.countDocuments({
                networkType: this.network.toLowerCase(),
                status: BBNStakeStatus.UNBONDED,
                endTimestamp: { $gte: startOfDay, $lte: endOfDay }
            });
            
            // Get total stake amount
            const stakeAmountResult = await BBNStake.aggregate([
                {
                    $match: {
                        networkType: this.network.toLowerCase(),
                        status: BBNStakeStatus.ACTIVE
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: '$amount' }
                    }
                }
            ]);
            
            const totalStakeAmount = stakeAmountResult.length > 0 ? stakeAmountResult[0].totalAmount : 0;
            
            // Count validators
            const validators = await BBNStake.distinct('validatorAddress', {
                networkType: this.network.toLowerCase(),
                status: BBNStakeStatus.ACTIVE
            });
            
            // Create or update stats record
            await this.updateStats({
                date: moment(targetDate).startOf('day').toDate(),
                periodType: StatPeriodType.DAILY,
                networkType: this.network.toLowerCase() as 'mainnet' | 'testnet',
                totalStakes,
                totalStakeAmount,
                activeStakes,
                newStakes,
                unbondedStakes,
                validators: validators.length
            });
            
            logger.info(`Daily stake stats calculated for ${moment(targetDate).format('YYYY-MM-DD')}`);
            
            // Update cache
            this.cacheService.set(
                `bbn_stake_stats_daily_${this.network}_${moment(targetDate).format('YYYY-MM-DD')}`,
                {
                    totalStakes,
                    totalStakeAmount,
                    activeStakes,
                    newStakes,
                    unbondedStakes,
                    validators: validators.length
                },
                60 * 60 * 24 // Cache for 24 hours
            );
        } catch (error) {
            logger.error('Error calculating daily stake stats:', error);
        } finally {
            this.isCalculating = false;
        }
    }

    /**
     * Calculates and updates weekly stake statistics
     */
    public async calculateWeeklyStats(targetDate: Date = new Date()): Promise<void> {
        try {
            const startOfWeek = moment(targetDate).startOf('week').toDate();
            const endOfWeek = moment(targetDate).endOf('week').toDate();
            
            logger.info(`Calculating weekly stake stats for week of ${moment(startOfWeek).format('YYYY-MM-DD')}`);
            
            // Aggregate daily stats for the week
            const dailyStats = await BBNStakeStats.find({
                periodType: StatPeriodType.DAILY,
                networkType: this.network.toLowerCase(),
                date: { 
                    $gte: startOfWeek,
                    $lte: endOfWeek
                }
            });
            
            if (dailyStats.length === 0) {
                logger.warn(`No daily stake stats found for week of ${moment(startOfWeek).format('YYYY-MM-DD')}`);
                return;
            }
            
            // Get the last day's stats for total counts
            const lastDayStats = dailyStats[dailyStats.length - 1];
            
            // Sum up new stakes and unbonded stakes for the week
            const newStakesWeek = dailyStats.reduce((sum, stat) => sum + stat.newStakes, 0);
            const unbondedStakesWeek = dailyStats.reduce((sum, stat) => sum + stat.unbondedStakes, 0);
            
            // Create or update weekly stats
            await this.updateStats({
                date: startOfWeek,
                periodType: StatPeriodType.WEEKLY,
                networkType: this.network.toLowerCase() as 'mainnet' | 'testnet',
                totalStakes: lastDayStats.totalStakes,
                totalStakeAmount: lastDayStats.totalStakeAmount,
                activeStakes: lastDayStats.activeStakes,
                newStakes: newStakesWeek,
                unbondedStakes: unbondedStakesWeek,
                validators: lastDayStats.validators
            });
            
            logger.info(`Weekly stake stats calculated for week of ${moment(startOfWeek).format('YYYY-MM-DD')}`);
            
            // Update cache
            this.cacheService.set(
                `bbn_stake_stats_weekly_${this.network}_${moment(startOfWeek).format('YYYY-MM-DD')}`,
                {
                    totalStakes: lastDayStats.totalStakes,
                    totalStakeAmount: lastDayStats.totalStakeAmount,
                    activeStakes: lastDayStats.activeStakes,
                    newStakes: newStakesWeek,
                    unbondedStakes: unbondedStakesWeek,
                    validators: lastDayStats.validators
                },
                60 * 60 * 24 * 7 // Cache for 7 days
            );
        } catch (error) {
            logger.error('Error calculating weekly stake stats:', error);
        }
    }

    /**
     * Calculates and updates monthly stake statistics
     */
    public async calculateMonthlyStats(targetDate: Date = new Date()): Promise<void> {
        try {
            const startOfMonth = moment(targetDate).startOf('month').toDate();
            const endOfMonth = moment(targetDate).endOf('month').toDate();
            
            logger.info(`Calculating monthly stake stats for ${moment(startOfMonth).format('YYYY-MM')}`);
            
            // Aggregate daily stats for the month
            const dailyStats = await BBNStakeStats.find({
                periodType: StatPeriodType.DAILY,
                networkType: this.network.toLowerCase(),
                date: { 
                    $gte: startOfMonth,
                    $lte: endOfMonth
                }
            });
            
            if (dailyStats.length === 0) {
                logger.warn(`No daily stake stats found for month of ${moment(startOfMonth).format('YYYY-MM')}`);
                return;
            }
            
            // Get the last day's stats for total counts
            const lastDayStats = dailyStats[dailyStats.length - 1];
            
            // Sum up new stakes and unbonded stakes for the month
            const newStakesMonth = dailyStats.reduce((sum, stat) => sum + stat.newStakes, 0);
            const unbondedStakesMonth = dailyStats.reduce((sum, stat) => sum + stat.unbondedStakes, 0);
            
            // Create or update monthly stats
            await this.updateStats({
                date: startOfMonth,
                periodType: StatPeriodType.MONTHLY,
                networkType: this.network.toLowerCase() as 'mainnet' | 'testnet',
                totalStakes: lastDayStats.totalStakes,
                totalStakeAmount: lastDayStats.totalStakeAmount,
                activeStakes: lastDayStats.activeStakes,
                newStakes: newStakesMonth,
                unbondedStakes: unbondedStakesMonth,
                validators: lastDayStats.validators
            });
            
            logger.info(`Monthly stake stats calculated for ${moment(startOfMonth).format('YYYY-MM')}`);
            
            // Update cache
            this.cacheService.set(
                `bbn_stake_stats_monthly_${this.network}_${moment(startOfMonth).format('YYYY-MM')}`,
                {
                    totalStakes: lastDayStats.totalStakes,
                    totalStakeAmount: lastDayStats.totalStakeAmount,
                    activeStakes: lastDayStats.activeStakes,
                    newStakes: newStakesMonth,
                    unbondedStakes: unbondedStakesMonth,
                    validators: lastDayStats.validators
                },
                60 * 60 * 24 * 30 // Cache for 30 days
            );
        } catch (error) {
            logger.error('Error calculating monthly stake stats:', error);
        }
    }

    /**
     * Calculates and updates all-time stake statistics
     */
    public async calculateAllTimeStats(): Promise<void> {
        try {
            logger.info(`Calculating all-time stake stats for ${this.network}`);
            
            // Get first stake date
            const firstStake = await BBNStake.findOne({
                networkType: this.network.toLowerCase()
            }).sort({ startTimestamp: 1 });
            
            if (!firstStake) {
                logger.warn(`No stakes found for ${this.network}`);
                return;
            }
            
            // Get current stats directly
            const totalStakes = await BBNStake.countDocuments({
                networkType: this.network.toLowerCase()
            });
            
            const activeStakes = await BBNStake.countDocuments({
                networkType: this.network.toLowerCase(),
                status: BBNStakeStatus.ACTIVE
            });
            
            // Get total new stakes (all ever created)
            const newStakes = totalStakes;
            
            // Get total unbonded stakes
            const unbondedStakes = await BBNStake.countDocuments({
                networkType: this.network.toLowerCase(),
                status: BBNStakeStatus.UNBONDED
            });
            
            // Get total stake amount
            const stakeAmountResult = await BBNStake.aggregate([
                {
                    $match: {
                        networkType: this.network.toLowerCase(),
                        status: BBNStakeStatus.ACTIVE
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: '$amount' }
                    }
                }
            ]);
            
            const totalStakeAmount = stakeAmountResult.length > 0 ? stakeAmountResult[0].totalAmount : 0;
            
            // Count validators
            const validators = await BBNStake.distinct('validatorAddress', {
                networkType: this.network.toLowerCase()
            });
            
            // Create or update all-time stats
            await this.updateStats({
                date: new Date(firstStake.startTimestamp), // Using first stake date as reference
                periodType: StatPeriodType.ALL_TIME,
                networkType: this.network.toLowerCase() as 'mainnet' | 'testnet',
                totalStakes,
                totalStakeAmount,
                activeStakes,
                newStakes,
                unbondedStakes,
                validators: validators.length
            });
            
            logger.info(`All-time stake stats calculated for ${this.network}`);
            
            // Update cache
            this.cacheService.set(
                `bbn_stake_stats_all_time_${this.network}`,
                {
                    totalStakes,
                    totalStakeAmount,
                    activeStakes,
                    newStakes,
                    unbondedStakes,
                    validators: validators.length,
                    firstStakeDate: new Date(firstStake.startTimestamp)
                },
                60 * 60 * 24 // Cache for 24 hours
            );
        } catch (error) {
            logger.error('Error calculating all-time stake stats:', error);
        }
    }

    /**
     * Creates or updates a stats record
     */
    private async updateStats(data: {
        date: Date;
        periodType: StatPeriodType;
        networkType: 'mainnet' | 'testnet';
        totalStakes: number;
        totalStakeAmount: number;
        activeStakes: number;
        newStakes: number;
        unbondedStakes: number;
        validators: number;
    }): Promise<void> {
        try {
            const query = {
                date: data.date,
                periodType: data.periodType,
                networkType: data.networkType
            };
            
            const update = {
                $set: {
                    totalStakes: data.totalStakes,
                    totalStakeAmount: data.totalStakeAmount,
                    activeStakes: data.activeStakes,
                    newStakes: data.newStakes,
                    unbondedStakes: data.unbondedStakes,
                    validators: data.validators,
                    lastUpdated: new Date()
                }
            };
            
            await BBNStakeStats.updateOne(query, update, { upsert: true });
        } catch (error) {
            logger.error('Error updating stake stats:', error);
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
                cacheKey = `bbn_stake_stats_daily_${this.network}_${moment(date).format('YYYY-MM-DD')}`;
            } else if (periodType === StatPeriodType.WEEKLY && date) {
                cacheKey = `bbn_stake_stats_weekly_${this.network}_${moment(date).startOf('week').format('YYYY-MM-DD')}`;
            } else if (periodType === StatPeriodType.MONTHLY && date) {
                cacheKey = `bbn_stake_stats_monthly_${this.network}_${moment(date).format('YYYY-MM')}`;
            } else if (periodType === StatPeriodType.ALL_TIME) {
                cacheKey = `bbn_stake_stats_all_time_${this.network}`;
            }
            
            if (cacheKey) {
                const cachedStats = this.cacheService.get(cacheKey);
                if (cachedStats) {
                    return cachedStats;
                }
            }
            
            // Get from database if not in cache
            const stats = await BBNStakeStats.findOne(query).sort({ date: -1 });
            
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
                return await BBNStakeStats.findOne(query);
            } else if (!stats && periodType === StatPeriodType.ALL_TIME) {
                await this.calculateAllTimeStats();
                return await BBNStakeStats.findOne(query);
            }
            
            return stats;
        } catch (error) {
            logger.error('Error getting stake stats:', error);
            throw error;
        }
    }
} 