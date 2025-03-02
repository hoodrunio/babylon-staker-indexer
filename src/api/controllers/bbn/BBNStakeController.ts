import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { BBNStakeStatus, StatPeriodType } from '../../../types/bbn';
import { BBNStake } from '../../../database/models';
import { BBNStakeIndexer } from '../../../services/bbn/BBNStakeIndexer';
import { BBNStakeStatsService } from '../../../services/stats/BBNStakeStatsService';
import { logger } from '../../../utils/logger';
import moment from 'moment';

export class BBNStakeController {
    /**
     * Get stakes with optional filters
     */
    public static async getStakes(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const stakerAddress = req.query.stakerAddress as string;
            const validatorAddress = req.query.validatorAddress as string;
            const status = req.query.status as BBNStakeStatus;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string).getTime() : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string).getTime() : undefined;
            
            logger.info(`Getting stakes for network=${network}, page=${page}, limit=${limit}, stakerAddress=${stakerAddress}, validatorAddress=${validatorAddress}, status=${status}`);
            
            const indexer = BBNStakeIndexer.getInstance(network);
            const result = await indexer.getStakes({
                network,
                stakerAddress,
                validatorAddress,
                status,
                startTime: startDate,
                endTime: endDate,
                page,
                limit
            });
            
            // Format response
            const response = {
                stakes: result.stakes.map(stake => ({
                    txHash: stake.txHash,
                    stakerAddress: stake.stakerAddress,
                    validatorAddress: stake.validatorAddress,
                    amount: stake.amount,
                    denom: stake.denom,
                    startTimestamp: stake.startTimestamp,
                    status: stake.status,
                    unbondingTime: stake.unbondingTime,
                    endTimestamp: stake.endTimestamp,
                    unbondingTxHash: stake.unbondingTxHash
                })),
                pagination: {
                    total: result.total,
                    page: result.page,
                    totalPages: result.totalPages,
                    hasNext: result.page < result.totalPages,
                    hasPrevious: result.page > 1
                }
            };
            
            res.json(response);
        } catch (error) {
            logger.error('Error in getStakes:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get stake by transaction hash
     */
    public static async getStakeByTxHash(req: Request, res: Response) {
        try {
            const { txHash } = req.params;
            const network = req.network || Network.TESTNET;
            
            logger.info(`Getting stake with txHash=${txHash}, network=${network}`);
            
            const stake = await BBNStake.findOne({
                txHash,
                networkType: network.toLowerCase()
            });
            
            if (!stake) {
                return res.status(404).json({ error: 'Stake not found' });
            }
            
            res.json({
                txHash: stake.txHash,
                stakerAddress: stake.stakerAddress,
                validatorAddress: stake.validatorAddress,
                amount: stake.amount,
                denom: stake.denom,
                startTimestamp: stake.startTimestamp,
                status: stake.status,
                unbondingTime: stake.unbondingTime,
                endTimestamp: stake.endTimestamp,
                unbondingTxHash: stake.unbondingTxHash
            });
        } catch (error) {
            logger.error('Error in getStakeByTxHash:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get stakes by staker address
     */
    public static async getStakesByStakerAddress(req: Request, res: Response) {
        try {
            const { address } = req.params;
            const network = req.network || Network.TESTNET;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const status = req.query.status as BBNStakeStatus;
            
            logger.info(`Getting stakes for stakerAddress=${address}, network=${network}, page=${page}, limit=${limit}, status=${status}`);
            
            const indexer = BBNStakeIndexer.getInstance(network);
            const result = await indexer.getStakes({
                network,
                stakerAddress: address,
                status,
                page,
                limit
            });
            
            // Format response (same as getStakes)
            const response = {
                stakes: result.stakes.map(stake => ({
                    txHash: stake.txHash,
                    stakerAddress: stake.stakerAddress,
                    validatorAddress: stake.validatorAddress,
                    amount: stake.amount,
                    denom: stake.denom,
                    startTimestamp: stake.startTimestamp,
                    status: stake.status,
                    unbondingTime: stake.unbondingTime,
                    endTimestamp: stake.endTimestamp,
                    unbondingTxHash: stake.unbondingTxHash
                })),
                pagination: {
                    total: result.total,
                    page: result.page,
                    totalPages: result.totalPages,
                    hasNext: result.page < result.totalPages,
                    hasPrevious: result.page > 1
                }
            };
            
            res.json(response);
        } catch (error) {
            logger.error('Error in getStakesByStakerAddress:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get stakes by validator address
     */
    public static async getStakesByValidatorAddress(req: Request, res: Response) {
        try {
            const { address } = req.params;
            const network = req.network || Network.TESTNET;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const status = req.query.status as BBNStakeStatus;
            
            logger.info(`Getting stakes for validatorAddress=${address}, network=${network}, page=${page}, limit=${limit}, status=${status}`);
            
            const indexer = BBNStakeIndexer.getInstance(network);
            const result = await indexer.getStakes({
                network,
                validatorAddress: address,
                status,
                page,
                limit
            });
            
            // Format response (same as getStakes)
            const response = {
                stakes: result.stakes.map(stake => ({
                    txHash: stake.txHash,
                    stakerAddress: stake.stakerAddress,
                    validatorAddress: stake.validatorAddress,
                    amount: stake.amount,
                    denom: stake.denom,
                    startTimestamp: stake.startTimestamp,
                    status: stake.status,
                    unbondingTime: stake.unbondingTime,
                    endTimestamp: stake.endTimestamp,
                    unbondingTxHash: stake.unbondingTxHash
                })),
                pagination: {
                    total: result.total,
                    page: result.page,
                    totalPages: result.totalPages,
                    hasNext: result.page < result.totalPages,
                    hasPrevious: result.page > 1
                }
            };
            
            res.json(response);
        } catch (error) {
            logger.error('Error in getStakesByValidatorAddress:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get daily stake statistics
     */
    public static async getDailyStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            let date = req.query.date ? new Date(req.query.date as string) : new Date();
            
            logger.info(`Getting daily stake stats for date=${date.toISOString()}, network=${network}`);
            
            const statsService = BBNStakeStatsService.getInstance(network);
            const stats = await statsService.getStats(StatPeriodType.DAILY, date);
            
            if (!stats) {
                return res.status(404).json({ error: 'Statistics not found' });
            }
            
            res.json({
                date: stats.date,
                totalStakes: stats.totalStakes,
                activeStakes: stats.activeStakes,
                newStakes: stats.newStakes,
                unbondedStakes: stats.unbondedStakes,
                totalStakeAmount: stats.totalStakeAmount,
                distinctValidators: stats.validators
            });
        } catch (error) {
            logger.error('Error in getDailyStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get weekly stake statistics
     */
    public static async getWeeklyStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            let date = req.query.date ? new Date(req.query.date as string) : new Date();
            
            logger.info(`Getting weekly stake stats for week of ${moment(date).startOf('week').format('YYYY-MM-DD')}, network=${network}`);
            
            const statsService = BBNStakeStatsService.getInstance(network);
            const stats = await statsService.getStats(StatPeriodType.WEEKLY, date);
            
            if (!stats) {
                return res.status(404).json({ error: 'Statistics not found' });
            }
            
            res.json({
                weekStartDate: stats.date,
                totalStakes: stats.totalStakes,
                activeStakes: stats.activeStakes,
                newStakes: stats.newStakes,
                unbondedStakes: stats.unbondedStakes,
                totalStakeAmount: stats.totalStakeAmount,
                distinctValidators: stats.validators
            });
        } catch (error) {
            logger.error('Error in getWeeklyStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get monthly stake statistics
     */
    public static async getMonthlyStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            let date = req.query.date ? new Date(req.query.date as string) : new Date();
            
            logger.info(`Getting monthly stake stats for ${moment(date).format('YYYY-MM')}, network=${network}`);
            
            const statsService = BBNStakeStatsService.getInstance(network);
            const stats = await statsService.getStats(StatPeriodType.MONTHLY, date);
            
            if (!stats) {
                return res.status(404).json({ error: 'Statistics not found' });
            }
            
            res.json({
                monthStartDate: stats.date,
                totalStakes: stats.totalStakes,
                activeStakes: stats.activeStakes,
                newStakes: stats.newStakes,
                unbondedStakes: stats.unbondedStakes,
                totalStakeAmount: stats.totalStakeAmount,
                distinctValidators: stats.validators
            });
        } catch (error) {
            logger.error('Error in getMonthlyStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get all-time stake statistics
     */
    public static async getAllTimeStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            
            logger.info(`Getting all-time stake stats for network=${network}`);
            
            const statsService = BBNStakeStatsService.getInstance(network);
            const stats = await statsService.getStats(StatPeriodType.ALL_TIME);
            
            if (!stats) {
                return res.status(404).json({ error: 'Statistics not found' });
            }
            
            res.json({
                firstRecordedDate: stats.date,
                totalStakes: stats.totalStakes,
                activeStakes: stats.activeStakes,
                newStakes: stats.newStakes,
                unbondedStakes: stats.unbondedStakes,
                totalStakeAmount: stats.totalStakeAmount,
                distinctValidators: stats.validators
            });
        } catch (error) {
            logger.error('Error in getAllTimeStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Trigger recalculation of statistics for a specific period
     * (Admin endpoint)
     */
    public static async recalculateStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            const periodType = req.query.periodType as StatPeriodType;
            const date = req.query.date ? new Date(req.query.date as string) : new Date();
            
            if (!periodType || !Object.values(StatPeriodType).includes(periodType)) {
                return res.status(400).json({ error: `Invalid periodType. Must be one of: ${Object.values(StatPeriodType).join(', ')}` });
            }
            
            logger.info(`Recalculating ${periodType} stake stats for date=${date.toISOString()}, network=${network}`);
            
            const statsService = BBNStakeStatsService.getInstance(network);
            
            if (periodType === StatPeriodType.DAILY) {
                await statsService.calculateDailyStats(date);
            } else if (periodType === StatPeriodType.WEEKLY) {
                await statsService.calculateWeeklyStats(date);
            } else if (periodType === StatPeriodType.MONTHLY) {
                await statsService.calculateMonthlyStats(date);
            } else if (periodType === StatPeriodType.ALL_TIME) {
                await statsService.calculateAllTimeStats();
            }
            
            res.json({ success: true, message: `${periodType} statistics recalculated successfully` });
        } catch (error) {
            logger.error('Error in recalculateStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 