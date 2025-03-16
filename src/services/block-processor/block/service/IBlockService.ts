/**
 * Block Service Interface
 * Defines business logic operations for blocks
 */

import { BaseBlock, PaginatedBlocksResponse } from '../../types/common';
import { Network } from '../../../../types/finality';

export interface IBlockService {
  /**
   * Gets block by height
   * If useRawFormat is true, returns raw block data from blockchain
   */
  getBlockByHeight(height: string | number, network: Network, useRawFormat?: boolean): Promise<BaseBlock | any | null>;
  
  /**
   * Gets block by hash
   * If useRawFormat is true, returns raw block data from blockchain
   */
  getBlockByHash(blockHash: string, network: Network, useRawFormat?: boolean): Promise<BaseBlock | any | null>;
  
  /**
   * Gets latest block
   * If useRawFormat is true, returns raw block data from blockchain
   */
  getLatestBlock(network: Network, useRawFormat?: boolean): Promise<BaseBlock | any | null>;
  
  /**
   * Gets total block count
   */
  getBlockCount(network: Network): Promise<number>;
  
  /**
   * Gets latest blocks with pagination
   */
  getLatestBlocks(
    network: Network,
    page?: number,
    limit?: number
  ): Promise<PaginatedBlocksResponse>;
  
  /**
   * Saves block
   */
  saveBlock(block: BaseBlock, network: Network): Promise<void>;
} 