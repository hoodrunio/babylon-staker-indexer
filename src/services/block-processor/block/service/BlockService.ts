/**
 * Block Service
 * Implements business logic for blocks
 */

import { BaseBlock, PaginatedBlocksResponse, SimpleBlock } from '../../types/common';
import { Network } from '../../../../types/finality';
import { IBlockService } from './IBlockService';
import { IBlockRepository } from '../repository/IBlockRepository';
import { BlockRepository } from '../repository/BlockRepository';
import { IBlockFetcherAdapter } from './IBlockFetcherAdapter';
import { BlockFetcherAdapter } from './BlockFetcherAdapter';
import { IValidatorInfoAdapter } from './IValidatorInfoAdapter';
import { ValidatorInfoAdapter } from './ValidatorInfoAdapter';
import { BlockMapper } from '../mapper/BlockMapper';
import { BlockCacheManager } from '../cache/BlockCacheManager';
import { logger } from '../../../../utils/logger';
import { IBlock } from '../../../../database/models/blockchain/Block';

export class BlockService implements IBlockService {
  private static instance: BlockService | null = null;
  private blockRepository: IBlockRepository;
  private blockFetcherAdapter: IBlockFetcherAdapter;
  private validatorInfoAdapter: IValidatorInfoAdapter;
  private cacheManager: BlockCacheManager;
  
  private constructor(
    blockRepository: IBlockRepository,
    blockFetcherAdapter: IBlockFetcherAdapter,
    validatorInfoAdapter: IValidatorInfoAdapter,
    cacheManager: BlockCacheManager
  ) {
    this.blockRepository = blockRepository;
    this.blockFetcherAdapter = blockFetcherAdapter;
    this.validatorInfoAdapter = validatorInfoAdapter;
    this.cacheManager = cacheManager;
  }
  
  /**
   * Singleton instance
   */
  public static getInstance(): BlockService {
    if (!BlockService.instance) {
      const blockRepository = BlockRepository.getInstance();
      const blockFetcherAdapter = BlockFetcherAdapter.getInstance();
      const validatorInfoAdapter = ValidatorInfoAdapter.getInstance();
      const cacheManager = BlockCacheManager.getInstance();
      
      BlockService.instance = new BlockService(
        blockRepository,
        blockFetcherAdapter,
        validatorInfoAdapter,
        cacheManager
      );
    }
    return BlockService.instance;
  }
  
  /**
   * Format error message consistently
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  
  /**
   * Gets block by height
   * If useRawFormat is true, returns raw block data from blockchain
   */
  public async getBlockByHeight(height: string | number, network: Network, useRawFormat: boolean = false): Promise<BaseBlock | any | null> {
    try {
      // If raw format is requested, always fetch from blockchain
      if (useRawFormat) {
        return await this.blockFetcherAdapter.fetchBlockByHeight(height, network);
      }
      
      // Check cache first
      const cacheKey = `block-height-${height}-${network}`;
      const cachedBlock = this.cacheManager.getCachedBlock(cacheKey);
      if (cachedBlock) {
        return cachedBlock;
      }
      
      // For standard format, first try to get from database
      const block = await this.blockRepository.findBlockByHeight(height.toString(), network);
      
      if (block) {
        const baseBlock = BlockMapper.mapToBaseBlock(block);
        this.cacheManager.cacheBlock(cacheKey, baseBlock);
        return baseBlock;
      }
      
      // If not found in database, try to fetch from blockchain
      const fetchedBlock = await this.fetchAndSaveBlockByHeight(height, network);
      if (fetchedBlock) {
        this.cacheManager.cacheBlock(cacheKey, fetchedBlock);
      }
      return fetchedBlock;
    } catch (error) {
      logger.error(`[BlockService] Error getting block by height: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Gets block by hash
   * If useRawFormat is true, returns raw block data from blockchain
   */
  public async getBlockByHash(blockHash: string, network: Network, useRawFormat: boolean = false): Promise<BaseBlock | any | null> {
    try {
      // If raw format is requested, always fetch from blockchain
      if (useRawFormat) {
        return await this.blockFetcherAdapter.fetchBlockByHash(blockHash, network);
      }
      
      // Check cache first
      const cacheKey = `block-hash-${blockHash}-${network}`;
      const cachedBlock = this.cacheManager.getCachedBlock(cacheKey);
      if (cachedBlock) {
        return cachedBlock;
      }
      
      // For standard format, first try to get from database
      const block = await this.blockRepository.findBlockByHash(blockHash, network);
      
      if (block) {
        const baseBlock = BlockMapper.mapToBaseBlock(block);
        this.cacheManager.cacheBlock(cacheKey, baseBlock);
        return baseBlock;
      }
      
      // If not found in database, try to fetch from blockchain
      const fetchedBlock = await this.fetchAndSaveBlockByHash(blockHash, network);
      if (fetchedBlock) {
        this.cacheManager.cacheBlock(cacheKey, fetchedBlock);
      }
      return fetchedBlock;
    } catch (error) {
      logger.error(`[BlockService] Error getting block by hash: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Gets latest block
   * If useRawFormat is true, returns raw block data from blockchain
   */
  public async getLatestBlock(network: Network, useRawFormat: boolean = false): Promise<BaseBlock | any | null> {
    try {
      // If raw format is requested, always fetch from blockchain
      if (useRawFormat) {
        return await this.blockFetcherAdapter.fetchLatestBlock(network);
      }
      
      // Check cache first
      const cacheKey = `block-latest-${network}`;
      const cachedBlock = this.cacheManager.getCachedBlock(cacheKey);
      if (cachedBlock) {
        return cachedBlock;
      }
      
      // For standard format, first try to get from database
      const block = await this.blockRepository.findLatestBlock(network);
      
      if (block) {
        const baseBlock = BlockMapper.mapToBaseBlock(block);
        this.cacheManager.cacheBlock(cacheKey, baseBlock);
        return baseBlock;
      }
      
      // If not found in database, try to fetch from blockchain
      const fetchedBlock = await this.fetchAndSaveLatestBlock(network);
      if (fetchedBlock) {
        this.cacheManager.cacheBlock(cacheKey, fetchedBlock);
      }
      return fetchedBlock;
    } catch (error) {
      logger.error(`[BlockService] Error getting latest block: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Gets total block count
   */
  public async getBlockCount(network: Network): Promise<number> {
    try {
      return await this.blockRepository.getBlockCount(network);
    } catch (error) {
      logger.error(`[BlockService] Error getting block count: ${this.formatError(error)}`);
      return 0;
    }
  }
  
  /**
   * Gets latest blocks with pagination
   */
  public async getLatestBlocks(
    network: Network,
    page: number = 1,
    limit: number = 50
  ): Promise<PaginatedBlocksResponse> {
    try {
      // Ensure page and limit are valid
      page = Math.max(1, page); // Minimum page is 1
      limit = Math.min(100, Math.max(1, limit)); // limit between 1 and 100
      
      // Cache key
      const cacheKey = `blocks-${network}-${page}-${limit}`;
      
      // Check cache
      const cachedData = this.cacheManager.getCachedPaginatedBlocks(cacheKey);
      if (cachedData) {
        return cachedData;
      }
      
      // Get paginated blocks
      const { blocks, total, pages } = await this.blockRepository.getPaginatedBlocks(
        network,
        page,
        limit
      );
      
      // Map to SimpleBlock
      const simpleBlocks: SimpleBlock[] = blocks.map((block: IBlock) => BlockMapper.mapToSimpleBlock(block));
      
      // Create response
      const response: PaginatedBlocksResponse = {
        blocks: simpleBlocks,
        pagination: {
          total,
          page,
          limit,
          pages
        }
      };
      
      // Cache the response
      this.cacheManager.cachePaginatedBlocks(cacheKey, response);
      
      return response;
    } catch (error) {
      logger.error(`[BlockService] Error getting latest blocks: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Saves block
   */
  public async saveBlock(block: BaseBlock, network: Network): Promise<void> {
    try {
      await this.blockRepository.saveBlock(block, network);
      
      // Clear cache for this block
      this.cacheManager.clearBlockCache(`block-height-${block.height}-${network}`);
      this.cacheManager.clearBlockCache(`block-hash-${block.blockHash}-${network}`);
      this.cacheManager.clearBlockCache(`block-latest-${network}`);
    } catch (error) {
      logger.error(`[BlockService] Error saving block: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Fetch block by height from blockchain, convert to BaseBlock, save to database, and return
   */
  private async fetchAndSaveBlockByHeight(height: string | number, network: Network): Promise<BaseBlock | null> {
    logger.info(`[BlockService] Block at height ${height} not found in storage, fetching from blockchain`);
    
    try {
      const blockDetails = await this.blockFetcherAdapter.fetchBlockByHeight(height, network);
      
      if (!blockDetails) {
        return null;
      }
      
      const baseBlock = await BlockMapper.convertRawBlockToBaseBlock(
        blockDetails, 
        network,
        this.validatorInfoAdapter
      );
      
      await this.saveBlock(baseBlock, network);
      return baseBlock;
    } catch (error) {
      logger.error(`[BlockService] Error fetching block by height: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Fetch block by hash from blockchain, convert to BaseBlock, save to database, and return
   */
  private async fetchAndSaveBlockByHash(blockHash: string, network: Network): Promise<BaseBlock | null> {
    logger.info(`[BlockService] Block with hash ${blockHash} not found in storage, fetching from blockchain`);
    
    try {
      const blockDetails = await this.blockFetcherAdapter.fetchBlockByHash(blockHash, network);
      
      if (!blockDetails) {
        return null;
      }
      
      const baseBlock = await BlockMapper.convertRawBlockToBaseBlock(
        blockDetails, 
        network,
        this.validatorInfoAdapter
      );
      
      await this.saveBlock(baseBlock, network);
      return baseBlock;
    } catch (error) {
      logger.error(`[BlockService] Error fetching block by hash: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Fetch latest block from blockchain, convert to BaseBlock, save to database, and return
   */
  private async fetchAndSaveLatestBlock(network: Network): Promise<BaseBlock | null> {
    logger.info(`[BlockService] Latest block not found in storage, fetching from blockchain`);
    
    try {
      const blockDetails = await this.blockFetcherAdapter.fetchLatestBlock(network);
      
      if (!blockDetails) {
        return null;
      }
      
      const baseBlock = await BlockMapper.convertRawBlockToBaseBlock(
        blockDetails, 
        network,
        this.validatorInfoAdapter
      );
      
      await this.saveBlock(baseBlock, network);
      return baseBlock;
    } catch (error) {
      logger.error(`[BlockService] Error fetching latest block: ${this.formatError(error)}`);
      return null;
    }
  }
}