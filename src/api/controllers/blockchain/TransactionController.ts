import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { BlockchainTransaction } from '../../../database/models/blockchain/Transaction';
import { logger } from '../../../utils/logger';
import { PaginatedTxsResponse, SimpleTx, TxStatus } from '../../../services/block-processor/types/common';
import { PipelineStage } from 'mongoose';

interface TransactionQuery {
    network: string;
    txHash?: string;
    height?: string;
    status?: string;
    type?: string;
    firstMessageType?: string;
    startTime?: string;
    endTime?: string;
}

export class TransactionController {
    /**
     * Cleaning function - to clean up quote characters
     */
    private static cleanQueryParam(param: string | undefined): string | undefined {
        if (!param) return undefined;
        // Remove leading and trailing quote characters and spaces
        return param.replace(/^["'\s]+|["'\s]+$/g, '');
    }

    public static async getTransactions(req: Request, res: Response) {
        try {
            const network = req.network || Network.TESTNET;
            const page = parseInt(req.query.page as string) || 1;
            let limit = parseInt(req.query.limit as string) || 10;
            if (limit > 100) {
                limit = 100;
            }
            const sortField = req.query.sort_field as string || 'time';
            const sortOrder = req.query.sort_order as string === 'asc' ? 1 : -1;
            
            // Cursor based pagination - last seen value
            const lastId = req.query.last_id as string;
            const lastValue = req.query.last_value as string;

            // Build query based on filters
            const query: TransactionQuery = {
                network: network
            };

            // Apply filters if provided - clean quotes
            if (req.query.tx_hash) {
                query.txHash = TransactionController.cleanQueryParam(req.query.tx_hash as string);
            }

            if (req.query.height) {
                query.height = TransactionController.cleanQueryParam(req.query.height as string);
            }

            if (req.query.status) {
                query.status = TransactionController.cleanQueryParam(req.query.status as string);
            }

            if (req.query.type) {
                query.type = TransactionController.cleanQueryParam(req.query.type as string);
            }

            if (req.query.message_type) {
                query.firstMessageType = TransactionController.cleanQueryParam(req.query.message_type as string);
            }

            if (req.query.start_time) {
                query.startTime = TransactionController.cleanQueryParam(req.query.start_time as string);
            }

            if (req.query.end_time) {
                query.endTime = TransactionController.cleanQueryParam(req.query.end_time as string);
            }

            // Build MongoDB aggregation pipeline for better performance
            const matchStage: any = { network: query.network };

            if (query.txHash) {
                matchStage.txHash = query.txHash;
            }

            if (query.height) {
                matchStage.height = query.height;
            }

            if (query.status) {
                matchStage.status = query.status;
            }

            if (query.type) {
                matchStage.type = query.type;
            }

            if (query.firstMessageType) {
                matchStage.firstMessageType = query.firstMessageType;
            }

            if (query.startTime || query.endTime) {
                matchStage.time = {};
                if (query.startTime) {
                    matchStage.time.$gte = query.startTime;
                }
                if (query.endTime) {
                    matchStage.time.$lte = query.endTime;
                }
            }

            // Range based pagination - additional condition
            if (lastId && lastValue) {
                // Determine range condition based on sort direction
                const rangeOperator = sortOrder === 1 ? '$gt' : '$lt';
                
                // Sort by sortField or by _id if equal
                matchStage.$or = [
                    { [sortField]: { [rangeOperator]: lastValue } },
                    { 
                        [sortField]: lastValue,
                        _id: { [rangeOperator]: lastId }
                    }
                ];
            }

            logger.info(`Fetching blockchain transactions with query: ${JSON.stringify(matchStage)}`);

            // Total count - separate query
            const countPipeline: PipelineStage[] = [
                { $match: matchStage },
                { $count: "total" }
            ];
            
            // Main data query - range based pagination
            const dataPipeline: PipelineStage[] = [
                { $match: matchStage },
                { $sort: { [sortField]: sortOrder === 1 ? 1 : -1, _id: sortOrder === 1 ? 1 : -1 } },
                { $limit: limit }
            ];

            // Run queries in parallel
            const [countResult, transactions] = await Promise.all([
                BlockchainTransaction.aggregate(countPipeline),
                BlockchainTransaction.aggregate(dataPipeline)
            ]);
            
            // Extract results
            const total = countResult.length > 0 ? countResult[0].total : 0;

            logger.info(`Found ${transactions.length} blockchain transactions out of ${total} total`);

            // Format response to match SimpleTx format
            const simpleTxs: SimpleTx[] = transactions.map((tx: any) => ({
                txHash: tx.txHash,
                height: tx.height,
                status: tx.status as TxStatus,
                type: tx.type,
                firstMessageType: tx.firstMessageType,
                time: tx.time,
                messageCount: tx.messageCount
            }));

            const totalPages = Math.ceil(total / limit);

            // Determine cursor values for next page
            let nextCursor = null;
            if (transactions.length === limit && transactions.length > 0) {
                const lastItem = transactions[transactions.length - 1];
                nextCursor = {
                    last_id: lastItem._id.toString(),
                    last_value: lastItem[sortField]
                };
            }

            // Create response in PaginatedTxsResponse format
            const response: PaginatedTxsResponse = {
                transactions: simpleTxs,
                pagination: {
                    total: total,
                    page: page,
                    limit: limit,
                    pages: totalPages
                }
            };

            // Add cursor information as extra metadata
            (response as any).cursor = nextCursor;

            res.json(response);
        } catch (error) {
            logger.error('Error in getTransactions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 