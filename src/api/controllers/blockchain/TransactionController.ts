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
     * Temizleme fonksiyonu - tırnak işaretlerini temizlemek için
     */
    private static cleanQueryParam(param: string | undefined): string | undefined {
        if (!param) return undefined;
        // Başındaki ve sonundaki tırnak işaretlerini ve boşlukları kaldır
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
            
            // Cursor tabanlı pagination için son görülen değer
            const lastId = req.query.last_id as string;
            const lastValue = req.query.last_value as string;

            // Build query based on filters
            const query: TransactionQuery = {
                network: network
            };

            // Apply filters if provided - tırnak işaretlerini temizleyerek
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

            // Range tabanlı pagination için ek koşul
            if (lastId && lastValue) {
                // Sıralama yönüne göre range koşulunu belirle
                const rangeOperator = sortOrder === 1 ? '$gt' : '$lt';
                
                // Ya sortField değerine göre ya da eşitse _id'ye göre sırala
                matchStage.$or = [
                    { [sortField]: { [rangeOperator]: lastValue } },
                    { 
                        [sortField]: lastValue,
                        _id: { [rangeOperator]: lastId }
                    }
                ];
            }

            logger.info(`Fetching blockchain transactions with query: ${JSON.stringify(matchStage)}`);

            // Toplam sayıyı almak için ayrı bir sorgu
            const countPipeline: PipelineStage[] = [
                { $match: matchStage },
                { $count: "total" }
            ];
            
            // Ana veri sorgusu - range tabanlı pagination ile
            const dataPipeline: PipelineStage[] = [
                { $match: matchStage },
                { $sort: { [sortField]: sortOrder === 1 ? 1 : -1, _id: sortOrder === 1 ? 1 : -1 } },
                { $limit: limit }
            ];

            // Sorguları paralel çalıştır
            const [countResult, transactions] = await Promise.all([
                BlockchainTransaction.aggregate(countPipeline),
                BlockchainTransaction.aggregate(dataPipeline)
            ]);
            
            // Sonuçları çıkar
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

            // Bir sonraki sayfa için cursor değerlerini belirle
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

            // Cursor bilgisini ekstra metadata olarak ekle
            (response as any).cursor = nextCursor;

            res.json(response);
        } catch (error) {
            logger.error('Error in getTransactions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 