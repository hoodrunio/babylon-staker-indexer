import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { BBNTransactionType, StatPeriodType } from '../../../types/bbn';
import { BBNTransaction } from '../../../database/models';
import { BBNTransactionIndexer } from '../../../services/bbn/BBNTransactionIndexer';
import { BBNTransactionStatsService } from '../../../services/stats/BBNTransactionStatsService';
import { logger } from '../../../utils/logger';
import moment from 'moment';

export class BBNTransactionController {
    /**
     * Get transactions with optional filters
     */
    public static async getTransactions(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const address = req.query.address as string;
            const type = req.query.type as BBNTransactionType;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string).getTime() : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string).getTime() : undefined;
            
            logger.info(`Getting transactions for network=${network}, page=${page}, limit=${limit}, address=${address}, type=${type}`);
            
            const indexer = BBNTransactionIndexer.getInstance(network);
            const result = await indexer.getTransactions({
                network,
                address,
                type,
                startTime: startDate,
                endTime: endDate,
                page,
                limit
            });
            
            // Format response
            const response = {
                transactions: result.transactions.map(tx => ({
                    txHash: tx.txHash,
                    sender: tx.sender,
                    receiver: tx.receiver,
                    amount: tx.amount,
                    denom: tx.denom,
                    type: tx.type,
                    timestamp: tx.timestamp,
                    status: tx.status,
                    fee: tx.fee,
                    memo: tx.memo,
                    blockHeight: tx.blockHeight
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
            logger.error('Error in getTransactions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get transaction by hash
     */
    public static async getTransactionByHash(req: Request, res: Response) {
        try {
            const { txHash } = req.params;
            const network = req.network || Network.TESTNET;
            
            logger.info(`Getting transaction with hash=${txHash}, network=${network}`);
            
            const transaction = await BBNTransaction.findOne({
                txHash,
                networkType: network.toLowerCase()
            });
            
            if (!transaction) {
                return res.status(404).json({ error: 'Transaction not found' });
            }
            
            res.json({
                txHash: transaction.txHash,
                sender: transaction.sender,
                receiver: transaction.receiver,
                amount: transaction.amount,
                denom: transaction.denom,
                type: transaction.type,
                timestamp: transaction.timestamp,
                status: transaction.status,
                fee: transaction.fee,
                memo: transaction.memo,
                blockHeight: transaction.blockHeight
            });
        } catch (error) {
            logger.error('Error in getTransactionByHash:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get transactions by address
     */
    public static async getTransactionsByAddress(req: Request, res: Response) {
        try {
            const { address } = req.params;
            const network = req.network || Network.TESTNET;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            
            logger.info(`Getting transactions for address=${address}, network=${network}, page=${page}, limit=${limit}`);
            
            const indexer = BBNTransactionIndexer.getInstance(network);
            const result = await indexer.getTransactions({
                network,
                address,
                page,
                limit
            });
            
            // Format response (same as getTransactions)
            const response = {
                transactions: result.transactions.map(tx => ({
                    txHash: tx.txHash,
                    sender: tx.sender,
                    receiver: tx.receiver,
                    amount: tx.amount,
                    denom: tx.denom,
                    type: tx.type,
                    timestamp: tx.timestamp,
                    status: tx.status,
                    fee: tx.fee,
                    memo: tx.memo,
                    blockHeight: tx.blockHeight
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
            logger.error('Error in getTransactionsByAddress:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get daily transaction statistics
     */
    public static async getDailyStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            let date = req.query.date ? new Date(req.query.date as string) : new Date();
            
            logger.info(`Getting daily transaction stats for date=${date.toISOString()}, network=${network}`);
            
            const statsService = BBNTransactionStatsService.getInstance(network);
            const stats = await statsService.getStats(StatPeriodType.DAILY, date);
            
            if (!stats) {
                return res.status(404).json({ error: 'Statistics not found' });
            }
            
            res.json({
                date: stats.date,
                totalTransactions: stats.totalTransactions,
                totalVolume: stats.totalVolume,
                activeAccounts: stats.activeAccounts,
                transactionsByType: stats.transactionsByType,
                averageFee: stats.averageFee
            });
        } catch (error) {
            logger.error('Error in getDailyStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get weekly transaction statistics
     */
    public static async getWeeklyStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            let date = req.query.date ? new Date(req.query.date as string) : new Date();
            
            logger.info(`Getting weekly transaction stats for week of ${moment(date).startOf('week').format('YYYY-MM-DD')}, network=${network}`);
            
            const statsService = BBNTransactionStatsService.getInstance(network);
            const stats = await statsService.getStats(StatPeriodType.WEEKLY, date);
            
            if (!stats) {
                return res.status(404).json({ error: 'Statistics not found' });
            }
            
            res.json({
                weekStartDate: stats.date,
                totalTransactions: stats.totalTransactions,
                totalVolume: stats.totalVolume,
                activeAccounts: stats.activeAccounts,
                transactionsByType: stats.transactionsByType,
                averageFee: stats.averageFee
            });
        } catch (error) {
            logger.error('Error in getWeeklyStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get monthly transaction statistics
     */
    public static async getMonthlyStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            let date = req.query.date ? new Date(req.query.date as string) : new Date();
            
            logger.info(`Getting monthly transaction stats for ${moment(date).format('YYYY-MM')}, network=${network}`);
            
            const statsService = BBNTransactionStatsService.getInstance(network);
            const stats = await statsService.getStats(StatPeriodType.MONTHLY, date);
            
            if (!stats) {
                return res.status(404).json({ error: 'Statistics not found' });
            }
            
            res.json({
                monthStartDate: stats.date,
                totalTransactions: stats.totalTransactions,
                totalVolume: stats.totalVolume,
                activeAccounts: stats.activeAccounts,
                transactionsByType: stats.transactionsByType,
                averageFee: stats.averageFee
            });
        } catch (error) {
            logger.error('Error in getMonthlyStats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    
    /**
     * Get all-time transaction statistics
     */
    public static async getAllTimeStats(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            
            logger.info(`Getting all-time transaction stats for network=${network}`);
            
            const statsService = BBNTransactionStatsService.getInstance(network);
            const stats = await statsService.getStats(StatPeriodType.ALL_TIME);
            
            if (!stats) {
                return res.status(404).json({ error: 'Statistics not found' });
            }
            
            res.json({
                firstRecordedDate: stats.date,
                totalTransactions: stats.totalTransactions,
                totalVolume: stats.totalVolume,
                activeAccounts: stats.activeAccounts,
                transactionsByType: stats.transactionsByType,
                averageFee: stats.averageFee
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
            
            logger.info(`Recalculating ${periodType} transaction stats for date=${date.toISOString()}, network=${network}`);
            
            const statsService = BBNTransactionStatsService.getInstance(network);
            
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