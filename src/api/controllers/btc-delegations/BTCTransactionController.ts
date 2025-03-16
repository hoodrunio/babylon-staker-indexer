import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { NewBTCDelegation } from '../../../database/models/NewBTCDelegation';
import { formatSatoshis } from '../../../utils/util';
import { logger } from '../../../utils/logger';
import { PipelineStage } from 'mongoose';

interface TransactionQuery {
    networkType: string;
    stakerAddress?: string;
    startHeight?: number;
    endHeight?: number;
    startDate?: Date;
    endDate?: Date;
    minAmount?: number;
    maxAmount?: number;
    state?: string;
}

export class BTCTransactionController {
    /**
     * Cleaning function - removes quotes and spaces
     */
    private static cleanQueryParam(param: string | undefined): string | undefined {
        if (!param) return undefined;
        // Remove leading and trailing quotes and spaces
        return param.replace(/^["'\s]+|["'\s]+$/g, '');
    }

    public static async getBTCTransactions(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            const page = parseInt(req.query.page as string) || 1;
            let limit = parseInt(req.query.limit as string) || 10;
            if (limit > 100) {
                limit = 100;
            }
            const skip = (page - 1) * limit;
            const sortField = req.query.sort_field as string || 'createdAt';
            const sortOrder = req.query.sort_order as string === 'asc' ? 1 : -1;
            
            // Last seen value for cursor-based pagination
            const lastId = req.query.last_id as string;
            const lastValue = req.query.last_value as string;

            // Build query based on filters
            const query: TransactionQuery = {
                networkType: network.toLowerCase()
            };

            // Apply filters if provided - cleaning quotes
            if (req.query.staker_address) {
                query.stakerAddress = BTCTransactionController.cleanQueryParam(req.query.staker_address as string);
            }

            if (req.query.state) {
                query.state = BTCTransactionController.cleanQueryParam(req.query.state as string);
            }

            if (req.query.min_height) {
                const cleanHeight = BTCTransactionController.cleanQueryParam(req.query.min_height as string);
                query.startHeight = cleanHeight ? parseInt(cleanHeight) : undefined;
            }

            if (req.query.max_height) {
                const cleanHeight = BTCTransactionController.cleanQueryParam(req.query.max_height as string);
                query.endHeight = cleanHeight ? parseInt(cleanHeight) : undefined;
            }

            if (req.query.start_date) {
                const cleanDate = BTCTransactionController.cleanQueryParam(req.query.start_date as string);
                query.startDate = cleanDate ? new Date(cleanDate) : undefined;
            }

            if (req.query.end_date) {
                const cleanDate = BTCTransactionController.cleanQueryParam(req.query.end_date as string);
                query.endDate = cleanDate ? new Date(cleanDate) : undefined;
            }

            if (req.query.min_amount) {
                const cleanAmount = BTCTransactionController.cleanQueryParam(req.query.min_amount as string);
                query.minAmount = cleanAmount ? parseInt(cleanAmount) : undefined;
            }

            if (req.query.max_amount) {
                const cleanAmount = BTCTransactionController.cleanQueryParam(req.query.max_amount as string);
                query.maxAmount = cleanAmount ? parseInt(cleanAmount) : undefined;
            }

            // Build MongoDB aggregation pipeline for better performance
            const matchStage: any = { networkType: query.networkType };

            if (query.stakerAddress) {
                matchStage.stakerAddress = query.stakerAddress;
            }

            if (query.state) {
                matchStage.state = query.state;
            }

            if (query.startHeight) {
                matchStage.startHeight = { $gte: query.startHeight };
            }

            if (query.endHeight) {
                matchStage.endHeight = { $lte: query.endHeight };
            }

            if (query.startDate || query.endDate) {
                matchStage.createdAt = {};
                if (query.startDate) {
                    matchStage.createdAt.$gte = query.startDate;
                }
                if (query.endDate) {
                    matchStage.createdAt.$lte = query.endDate;
                }
            }

            if (query.minAmount || query.maxAmount) {
                matchStage.totalSat = {};
                if (query.minAmount) {
                    matchStage.totalSat.$gte = query.minAmount;
                }
                if (query.maxAmount) {
                    matchStage.totalSat.$lte = query.maxAmount;
                }
            }

            // Additional condition for range-based pagination
            if (lastId && lastValue) {
                // Determine the range condition based on the sort direction
                const rangeOperator = sortOrder === 1 ? '$gt' : '$lt';
                
                // Sort by sortField or, if equal, by _id
                matchStage.$or = [
                    { [sortField]: { [rangeOperator]: lastValue } },
                    { 
                        [sortField]: lastValue,
                        _id: { [rangeOperator]: lastId }
                    }
                ];
            }

            logger.info(`Fetching BTC transactions with query: ${JSON.stringify(matchStage)}`);

            // Separate query to get the total count
            const countPipeline: PipelineStage[] = [
                { $match: matchStage },
                { $count: "total" }
            ];
            
            // Main data query - supports both skip/limit and range-based pagination
            const dataPipeline: PipelineStage[] = [
                { $match: matchStage },
                { $sort: { [sortField]: sortOrder === 1 ? 1 : -1, _id: sortOrder === 1 ? 1 : -1 } }
            ];

            // Add skip/limit if cursor-based pagination is not used
            if (!lastId && !lastValue) {
                dataPipeline.push(
                    { $skip: skip },
                    { $limit: limit }
                );
            } else {
                // Add only limit for cursor-based pagination
                dataPipeline.push({ $limit: limit });
            }

            // Execute queries in parallel
            const [countResult, transactions] = await Promise.all([
                NewBTCDelegation.aggregate(countPipeline),
                NewBTCDelegation.aggregate(dataPipeline)
            ]);
            
            // Extract results
            const total = countResult.length > 0 ? countResult[0].total : 0;

            logger.info(`Found ${transactions.length} BTC transactions out of ${total} total`);

            // Format response
            const formattedTransactions = transactions.map((tx: any) => ({
                staker_address: tx.stakerAddress,
                staker_btc_address: tx.stakerBtcAddress || '',
                status: tx.state,
                amount: formatSatoshis(tx.totalSat),
                amount_sat: tx.totalSat,
                start_height: tx.startHeight,
                end_height: tx.endHeight || 0,
                staking_time: tx.stakingTime,
                unbonding_time: tx.unbondingTime,
                btc_transaction_id: tx.stakingTxIdHex,
                block_height: tx.blockHeight,
                babylon_tx_hash: tx.txHash,
                created_at: tx.createdAt,
                updated_at: tx.updatedAt
            }));

            const totalPages = Math.ceil(total / limit);
            
            // Determine cursor values for the next page
            let nextCursor = null;
            if (transactions.length === limit && transactions.length > 0) {
                const lastItem = transactions[transactions.length - 1];
                nextCursor = {
                    last_id: lastItem._id.toString(),
                    last_value: lastItem[sortField]
                };
            }

            const response = {
                transactions: formattedTransactions,
                pagination: {
                    total_count: total,
                    total_pages: totalPages,
                    current_page: page,
                    has_next: page < totalPages,
                    has_previous: page > 1,
                    next_page: page < totalPages ? page + 1 : null,
                    previous_page: page > 1 ? page - 1 : null
                },
                cursor: nextCursor
            };

            res.json(response);
        } catch (error) {
            logger.error('Error in getBTCTransactions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}