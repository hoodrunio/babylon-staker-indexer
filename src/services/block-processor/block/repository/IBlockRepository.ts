/**
 * Block Repository Interface
 * Defines database operations for blocks
 */

import { BaseBlock } from '../../types/common';
import { Network } from '../../../../types/finality';
import { IBlock } from '../../../../database/models/blockchain/Block';

export interface IBlockRepository {
  /**
   * Saves block to database
   */
  saveBlock(block: BaseBlock, network: Network): Promise<void>;
  
  /**
   * Finds block by height
   */
  findBlockByHeight(height: string, network: Network): Promise<IBlock | null>;
  
  /**
   * Finds block by hash
   */
  findBlockByHash(blockHash: string, network: Network): Promise<IBlock | null>;
  
  /**
   * Finds latest block
   */
  findLatestBlock(network: Network): Promise<IBlock | null>;
  
  /**
   * Gets total block count
   */
  getBlockCount(network: Network): Promise<number>;
  
  /**
   * Gets paginated blocks
   */
  getPaginatedBlocks(
    network: Network,
    page: number,
    limit: number,
    sortOptions?: Record<string, any>
  ): Promise<{
    blocks: IBlock[],
    total: number,
    pages: number
  }>;
} 