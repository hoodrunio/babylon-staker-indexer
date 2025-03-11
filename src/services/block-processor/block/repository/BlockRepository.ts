/**
 * Block Repository
 * Implements database operations for blocks
 */

import { BaseBlock } from '../../types/common';
import { Network } from '../../../../types/finality';
import { Block, IBlock } from '../../../../database/models/blockchain/Block';
import { IBlockRepository } from './IBlockRepository';
import { logger } from '../../../../utils/logger';

export class BlockRepository implements IBlockRepository {
  private static instance: BlockRepository | null = null;
  
  private constructor() {
    // Private constructor to enforce singleton pattern
  }
  
  /**
   * Singleton instance
   */
  public static getInstance(): BlockRepository {
    if (!BlockRepository.instance) {
      BlockRepository.instance = new BlockRepository();
    }
    return BlockRepository.instance;
  }
  
  /**
   * Format error message consistently
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  
  /**
   * Saves block to database
   */
  public async saveBlock(block: BaseBlock, network: Network): Promise<void> {
    try {
      // Save to database
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
      
      logger.debug(`[BlockRepository] Block saved to database: ${block.height}`);
    } catch (error) {
      logger.error(`[BlockRepository] Error saving block to database: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Finds block by height
   */
  public async findBlockByHeight(height: string, network: Network): Promise<IBlock | null> {
    try {
      return await Block.findOne({ height, network })
        .populate('proposer', 'moniker valoper_address logo_url')
        .populate('signatures.validator', 'moniker valoper_address logo_url');
    } catch (error) {
      logger.error(`[BlockRepository] Error finding block by height: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Finds block by hash
   */
  public async findBlockByHash(blockHash: string, network: Network): Promise<IBlock | null> {
    try {
      return await Block.findOne({ blockHash, network })
        .populate('proposer', 'moniker valoper_address logo_url')
        .populate('signatures.validator', 'moniker valoper_address logo_url');
    } catch (error) {
      logger.error(`[BlockRepository] Error finding block by hash: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Finds latest block
   */
  public async findLatestBlock(network: Network): Promise<IBlock | null> {
    try {
      return await Block.findOne({ network })
        .sort({ height: -1 })
        .populate('proposer', 'moniker valoper_address logo_url')
        .populate('signatures.validator', 'moniker valoper_address logo_url');
    } catch (error) {
      logger.error(`[BlockRepository] Error finding latest block: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Gets total block count
   */
  public async getBlockCount(network: Network): Promise<number> {
    try {
      return await Block.countDocuments({ network });
    } catch (error) {
      logger.error(`[BlockRepository] Error getting block count: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Gets paginated blocks
   */
  public async getPaginatedBlocks(
    network: Network,
    page: number = 1,
    limit: number = 50,
    sortOptions: Record<string, any> = { height: -1 }
  ): Promise<{
    blocks: IBlock[],
    total: number,
    pages: number
  }> {
    try {
      // Ensure page and limit are valid
      page = Math.max(1, page); // Minimum page is 1
      limit = Math.min(100, Math.max(1, limit)); // limit between 1 and 100
      
      // Get total count for pagination
      const total = await this.getBlockCount(network);
      
      // Calculate total pages
      const pages = Math.ceil(total / limit);
      
      // Calculate skip value for pagination
      const skip = (page - 1) * limit;
      
      // Get blocks
      const blocks = await Block.find({ network })
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .populate('proposer', 'moniker valoper_address logo_url')
        .select('height blockHash proposer numTxs time');
      
      return {
        blocks,
        total,
        pages
      };
    } catch (error) {
      logger.error(`[BlockRepository] Error getting paginated blocks: ${this.formatError(error)}`);
      throw error;
    }
  }
} 