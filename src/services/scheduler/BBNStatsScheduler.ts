import cron from 'node-cron';
import { Network } from '../../types/finality';
import { BBNTransactionStatsService } from '../stats/BBNTransactionStatsService';
import { BBNStakeStatsService } from '../stats/BBNStakeStatsService';
import { logger } from '../../utils/logger';
import moment from 'moment';

/**
 * Scheduler service for BBN statistics calculations
 */
export class BBNStatsScheduler {
    private static instance: BBNStatsScheduler;
    private isRunning: boolean = false;
    private dailyJob: cron.ScheduledTask | null = null;
    private weeklyJob: cron.ScheduledTask | null = null;
    private monthlyJob: cron.ScheduledTask | null = null;
    
    /**
     * Private constructor to enforce singleton pattern
     */
    private constructor() {}
    
    /**
     * Get singleton instance
     */
    public static getInstance(): BBNStatsScheduler {
        if (!BBNStatsScheduler.instance) {
            BBNStatsScheduler.instance = new BBNStatsScheduler();
        }
        return BBNStatsScheduler.instance;
    }
    
    /**
     * Start the scheduler
     */
    public start(): void {
        if (this.isRunning) {
            logger.warn('BBNStatsScheduler is already running');
            return;
        }
        
        logger.info('Starting BBNStatsScheduler...');
        
        // Schedule daily stats calculation at 00:05 every day
        this.dailyJob = cron.schedule('5 0 * * *', async () => {
            const yesterday = moment().subtract(1, 'day').toDate();
            logger.info(`Calculating daily BBN stats for ${yesterday.toISOString()}`);
            
            try {
                await this.calculateDailyStats(yesterday);
                logger.info('Daily BBN stats calculation completed');
            } catch (error) {
                logger.error('Error calculating daily BBN stats:', error);
            }
        });
        
        // Schedule weekly stats calculation at 00:15 every Monday
        this.weeklyJob = cron.schedule('15 0 * * 1', async () => {
            const lastWeek = moment().subtract(1, 'week').toDate();
            logger.info(`Calculating weekly BBN stats for week of ${moment(lastWeek).startOf('week').format('YYYY-MM-DD')}`);
            
            try {
                await this.calculateWeeklyStats(lastWeek);
                logger.info('Weekly BBN stats calculation completed');
            } catch (error) {
                logger.error('Error calculating weekly BBN stats:', error);
            }
        });
        
        // Schedule monthly stats calculation at 00:30 on the 1st of every month
        this.monthlyJob = cron.schedule('30 0 1 * *', async () => {
            const lastMonth = moment().subtract(1, 'month').toDate();
            logger.info(`Calculating monthly BBN stats for ${moment(lastMonth).format('YYYY-MM')}`);
            
            try {
                await this.calculateMonthlyStats(lastMonth);
                logger.info('Monthly BBN stats calculation completed');
            } catch (error) {
                logger.error('Error calculating monthly BBN stats:', error);
            }
        });
        
        this.isRunning = true;
        logger.info('BBNStatsScheduler started successfully');
    }
    
    /**
     * Stop the scheduler
     */
    public stop(): void {
        if (!this.isRunning) {
            logger.warn('BBNStatsScheduler is not running');
            return;
        }
        
        logger.info('Stopping BBNStatsScheduler...');
        
        if (this.dailyJob) {
            this.dailyJob.stop();
            this.dailyJob = null;
        }
        
        if (this.weeklyJob) {
            this.weeklyJob.stop();
            this.weeklyJob = null;
        }
        
        if (this.monthlyJob) {
            this.monthlyJob.stop();
            this.monthlyJob = null;
        }
        
        this.isRunning = false;
        logger.info('BBNStatsScheduler stopped successfully');
    }
    
    /**
     * Calculate daily stats for both transaction and stake services
     */
    private async calculateDailyStats(date: Date): Promise<void> {
        const networks = [Network.MAINNET, Network.TESTNET];
        
        for (const network of networks) {
            logger.info(`Calculating daily BBN transaction stats for network=${network}, date=${date.toISOString()}`);
            
            try {
                const txStatsService = BBNTransactionStatsService.getInstance(network);
                await txStatsService.calculateDailyStats(date);
                
                const stakeStatsService = BBNStakeStatsService.getInstance(network);
                await stakeStatsService.calculateDailyStats(date);
                
                logger.info(`Daily BBN stats calculation for network=${network} completed`);
            } catch (error) {
                logger.error(`Error calculating daily BBN stats for network=${network}:`, error);
            }
        }
    }
    
    /**
     * Calculate weekly stats for both transaction and stake services
     */
    private async calculateWeeklyStats(date: Date): Promise<void> {
        const networks = [Network.MAINNET, Network.TESTNET];
        
        for (const network of networks) {
            logger.info(`Calculating weekly BBN transaction stats for network=${network}, week of ${moment(date).startOf('week').format('YYYY-MM-DD')}`);
            
            try {
                const txStatsService = BBNTransactionStatsService.getInstance(network);
                await txStatsService.calculateWeeklyStats(date);
                
                const stakeStatsService = BBNStakeStatsService.getInstance(network);
                await stakeStatsService.calculateWeeklyStats(date);
                
                logger.info(`Weekly BBN stats calculation for network=${network} completed`);
            } catch (error) {
                logger.error(`Error calculating weekly BBN stats for network=${network}:`, error);
            }
        }
    }
    
    /**
     * Calculate monthly stats for both transaction and stake services
     */
    private async calculateMonthlyStats(date: Date): Promise<void> {
        const networks = [Network.MAINNET, Network.TESTNET];
        
        for (const network of networks) {
            logger.info(`Calculating monthly BBN transaction stats for network=${network}, month=${moment(date).format('YYYY-MM')}`);
            
            try {
                const txStatsService = BBNTransactionStatsService.getInstance(network);
                await txStatsService.calculateMonthlyStats(date);
                
                const stakeStatsService = BBNStakeStatsService.getInstance(network);
                await stakeStatsService.calculateMonthlyStats(date);
                
                logger.info(`Monthly BBN stats calculation for network=${network} completed`);
            } catch (error) {
                logger.error(`Error calculating monthly BBN stats for network=${network}:`, error);
            }
        }
    }
    
    /**
     * Calculate all-time stats for both transaction and stake services
     */
    public async calculateAllTimeStats(): Promise<void> {
        const networks = [Network.MAINNET, Network.TESTNET];
        
        for (const network of networks) {
            logger.info(`Calculating all-time BBN stats for network=${network}`);
            
            try {
                const txStatsService = BBNTransactionStatsService.getInstance(network);
                await txStatsService.calculateAllTimeStats();
                
                const stakeStatsService = BBNStakeStatsService.getInstance(network);
                await stakeStatsService.calculateAllTimeStats();
                
                logger.info(`All-time BBN stats calculation for network=${network} completed`);
            } catch (error) {
                logger.error(`Error calculating all-time BBN stats for network=${network}:`, error);
            }
        }
    }
    
    /**
     * Run on-demand calculations for a specific date 
     * Useful for backfilling statistics or testing
     */
    public async runOnDemand(date: Date = new Date()): Promise<void> {
        logger.info(`Running on-demand BBN stats calculation for date=${date.toISOString()}`);
        
        try {
            await this.calculateDailyStats(date);
            await this.calculateWeeklyStats(date);
            await this.calculateMonthlyStats(date);
            await this.calculateAllTimeStats();
            
            logger.info('On-demand BBN stats calculation completed');
        } catch (error) {
            logger.error('Error in on-demand BBN stats calculation:', error);
            throw error;
        }
    }
} 