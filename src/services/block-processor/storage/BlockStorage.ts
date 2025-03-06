/**
 * Block Storage Service
 * Blok verilerini veritabanında saklar
 */

import { BaseBlock } from '../types/common';
import { IBlockStorage } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { Block, IBlock } from '../../../database/models/blockchain/Block';
import { Network } from '../../../types/finality';

/**
 * Blok verilerini saklayan servis
 */
export class BlockStorage implements IBlockStorage {
    private static instance: BlockStorage | null = null;
    
    private constructor() {
        // Private constructor
    }
    
    /**
     * Singleton instance
     */
    public static getInstance(): BlockStorage {
        if (!BlockStorage.instance) {
            BlockStorage.instance = new BlockStorage();
        }
        return BlockStorage.instance;
    }
    
    /**
     * Bloğu veritabanına kaydeder
     */
    public async saveBlock(block: BaseBlock, network: Network): Promise<void> {
        try {
            // Veritabanına kaydet
            await Block.findOneAndUpdate(
                { 
                    blockHash: block.blockHash,
                    network: network
                },
                {
                    ...block,
                    network: network
                },
                { 
                    upsert: true, 
                    new: true,
                    setDefaultsOnInsert: true
                }
            );
            
            logger.debug(`[BlockStorage] Block saved to database: ${block.height}`);
        } catch (error) {
            logger.error(`[BlockStorage] Error saving block to database: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Belirli bir yükseklikteki bloğu veritabanından getirir
     */
    public async getBlockByHeight(height: string | number, network: Network): Promise<BaseBlock | null> {
        try {
            const heightStr = height.toString();
            const block = await Block.findOne({ height: heightStr, network: network });
            
            if (!block) {
                return null;
            }
            
            return this.mapToBaseBlock(block);
        } catch (error) {
            logger.error(`[BlockStorage] Error getting block by height from database: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    
    /**
     * Hash değerine göre bloğu veritabanından getirir
     */
    public async getBlockByHash(blockHash: string, network: Network): Promise<BaseBlock | null> {
        try {
            const block = await Block.findOne({ blockHash, network });
            
            if (!block) {
                return null;
            }
            
            return this.mapToBaseBlock(block);
        } catch (error) {
            logger.error(`[BlockStorage] Error getting block by hash from database: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    
    /**
     * En son bloğu veritabanından getirir
     */
    public async getLatestBlock(network: Network): Promise<BaseBlock | null> {
        try {
            const latestBlock = await Block.findOne({ network: network })
                .sort({ height: -1 })
                .limit(1);
                
            if (!latestBlock) {
                return null;
            }
            
            return this.mapToBaseBlock(latestBlock);
        } catch (error) {
            logger.error(`[BlockStorage] Error getting latest block from database: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    
    /**
     * Toplam blok sayısını veritabanından getirir
     */
    public async getBlockCount(network: Network): Promise<number> {
        try {
            return await Block.countDocuments({ network: network });
        } catch (error) {
            logger.error(`[BlockStorage] Error getting block count from database: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
        }
    }
    
    /**
     * IBlock modelini BaseBlock'a dönüştürür
     */
    private mapToBaseBlock(block: IBlock): BaseBlock {
        return {
            height: block.height,
            blockHash: block.blockHash,
            proposerAddress: block.proposerAddress,
            numTxs: block.numTxs,
            time: block.time,
            signatures: block.signatures.map(sig => ({
                validatorAddress: sig.validatorAddress,
                timestamp: sig.timestamp,
                signature: sig.signature
            })),
            appHash: block.appHash
        };
    }
} 