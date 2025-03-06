/**
 * Transaction Storage Service
 * İşlem verilerini veritabanında saklar
 */

import { BaseTx } from '../types/common';
import { ITxStorage } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { BlockchainTransaction, ITransaction } from '../../../database/models/blockchain/Transaction';
import { Network } from '../../../types/finality';

/**
 * İşlem verilerini saklayan servis
 */
export class TxStorage implements ITxStorage {
    private static instance: TxStorage | null = null;
    
    private constructor() {
        // Private constructor
    }
    
    /**
     * Singleton instance
     */
    public static getInstance(): TxStorage {
        if (!TxStorage.instance) {
            TxStorage.instance = new TxStorage();
        }
        return TxStorage.instance;
    }
    
    /**
     * İşlemi veritabanına kaydeder
     */
    public async saveTx(tx: BaseTx, network: Network): Promise<void> {
        try {
            // Veritabanına kaydet
            await BlockchainTransaction.findOneAndUpdate(
                { 
                    txHash: tx.txHash,
                    network: network
                },
                {
                    ...tx,
                    network: network
                },
                { 
                    upsert: true, 
                    new: true,
                    setDefaultsOnInsert: true
                }
            );
            
            logger.debug(`[TxStorage] Transaction saved to database: ${tx.txHash} at height ${tx.height}`);
        } catch (error) {
            logger.error(`[TxStorage] Error saving transaction to database: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Hash değerine göre işlemi veritabanından getirir
     */
    public async getTxByHash(txHash: string, network: Network): Promise<BaseTx | null> {
        try {
            const tx = await BlockchainTransaction.findOne({ txHash, network });
            
            if (!tx) {
                return null;
            }
            
            return this.mapToBaseTx(tx);
        } catch (error) {
            logger.error(`[TxStorage] Error getting transaction by hash from database: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    
    /**
     * Belirli bir yükseklikteki tüm işlemleri veritabanından getirir
     */
    public async getTxsByHeight(height: string | number, network: Network): Promise<BaseTx[]> {
        try {
            const heightStr = height.toString();
            const txs = await BlockchainTransaction.find({ height: heightStr, network });
            
            return txs.map(tx => this.mapToBaseTx(tx));
        } catch (error) {
            logger.error(`[TxStorage] Error getting transactions by height from database: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
    
    /**
     * Toplam işlem sayısını veritabanından getirir
     */
    public async getTxCount(network: Network): Promise<number> {
        try {
            return await BlockchainTransaction.countDocuments({ network });
        } catch (error) {
            logger.error(`[TxStorage] Error getting transaction count from database: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
        }
    }
    
    /**
     * ITransaction modelini BaseTx'e dönüştürür
     */
    private mapToBaseTx(tx: ITransaction): BaseTx {
        return {
            txHash: tx.txHash,
            height: tx.height,
            status: tx.status as any,
            fee: {
                amount: tx.fee.amount.map(amt => ({
                    denom: amt.denom,
                    amount: amt.amount
                })),
                gasLimit: tx.fee.gasLimit
            },
            messageCount: tx.messageCount,
            type: tx.type,
            time: tx.time,
            meta: tx.meta.map(m => ({
                typeUrl: m.typeUrl,
                content: m.content
            }))
        };
    }
} 