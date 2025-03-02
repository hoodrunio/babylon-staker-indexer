import { Request, Response } from 'express';
import { Network } from '../../types/finality';
import { StatPeriodType } from '../../types/bbn';
import { BBNTransactionStatsService } from '../../services/stats/BBNTransactionStatsService';
import { BBNStakeStatsService } from '../../services/stats/BBNStakeStatsService';
import { logger } from '../../utils/logger';

/**
 * Get stats for a specific network
 * @route GET /api/stats
 */
export const getNetworkStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const networkParam = req.query.network as string;
        // Case insensitive check for network parameter
        const network = networkParam && networkParam.toLowerCase() === 'testnet' 
            ? Network.TESTNET 
            : Network.MAINNET;
        
        // Period type (daily, weekly, monthly, all_time)
        const periodType = req.query.period_type as string || 'daily';
        let statPeriod: StatPeriodType;
        
        switch (periodType) {
            case 'weekly':
                statPeriod = StatPeriodType.WEEKLY;
                break;
            case 'monthly':
                statPeriod = StatPeriodType.MONTHLY;
                break;
            case 'all_time':
                statPeriod = StatPeriodType.ALL_TIME;
                break;
            default:
                statPeriod = StatPeriodType.DAILY;
                break;
        }
        
        // Date parameter (optional)
        let date: Date | undefined;
        if (req.query.date) {
            date = new Date(req.query.date as string);
        }
        
        // Get transaction stats
        const txStatsService = BBNTransactionStatsService.getInstance(network);
        const txStats = await txStatsService.getStats(statPeriod, date);
        
        // Get stake stats
        const stakeStatsService = BBNStakeStatsService.getInstance(network);
        const stakeStats = await stakeStatsService.getStats(statPeriod, date);
        
        res.json({
            network: network,
            periodType: statPeriod,
            date: date,
            transactionStats: txStats,
            stakeStats: stakeStats
        });
    } catch (error) {
        logger.error('Error getting network stats:', error);
        res.status(500).json({ error: 'Failed to get network stats' });
    }
}; 