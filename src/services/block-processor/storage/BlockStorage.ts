/**
 * Block Storage Service
 * Stores and fetches blocks in the database
 */

import { BaseBlock, PaginatedBlocksResponse } from '../types/common';
import { IBlockStorage } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { Network } from '../../../types/finality';
import { BlockService } from '../block/service/BlockService';
import { IBlockService } from '../block/service/IBlockService';
import { FutureBlockError } from '../../../types/errors';

/**
 * Service for storing block data
 * This class is a facade for the new modular block services
 */
export class BlockStorage implements IBlockStorage {
    private static instance: BlockStorage | null = null;
    private blockService: IBlockService;
    
    private constructor() {
        // Private constructor to enforce singleton pattern
        this.blockService = BlockService.getInstance();
    }
    
    /**
     * Format error message consistently
     */
    private formatError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
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
     * Saves block to database
     */
    public async saveBlock(block: BaseBlock, network: Network): Promise<void> {
        try {
            await this.blockService.saveBlock(block, network);
        } catch (error) {
            logger.error(`[BlockStorage] Error saving block to database: ${this.formatError(error)}`);
            throw error;
        }
    }
    
    /**
     * Gets block at specific height from database or blockchain
     * If useRawFormat is true, always fetches from blockchain regardless of database presence
     * If not found in database and fetcherService is available, tries to fetch from blockchain
     * @param height Block height
     * @param network Network type
     * @param useRawFormat If true, returns raw block data from blockchain
     * @returns Block data or null if not found
     */
    public async getBlockByHeight(height: string | number, network: Network, useRawFormat: boolean = false): Promise<BaseBlock | any | null> {
        try {
            return await this.blockService.getBlockByHeight(height, network, useRawFormat);
        } catch (error) {
            // Pass through FutureBlockError instances to be handled by controller
            if (error instanceof FutureBlockError) {
                throw error;
            }
            
            // Check for height not available errors and pass them through
            if (error instanceof Error && 
                (error.name === 'HeightNotAvailableError' || 
                 error.message.includes('SPECIAL_ERROR_HEIGHT_NOT_AVAILABLE') ||
                 error.message.includes('SPECIAL_ERROR_FUTURE_HEIGHT') ||
                 error.message.includes('is not available yet (future block)'))) {
                throw error;
            }
            
            logger.error(`[BlockStorage] Error getting block by height: ${this.formatError(error)}`);
            return null;
        }
    }
    
    /**
     * Gets block with specific hash from database or blockchain
     * If useRawFormat is true, always fetches from blockchain regardless of database presence
     * If not found in database and fetcherService is available, tries to fetch from blockchain
     * @param blockHash Block hash
     * @param network Network type
     * @param useRawFormat If true, returns raw block data from blockchain
     * @returns Block data or null if not found
     */
    public async getBlockByHash(blockHash: string, network: Network, useRawFormat: boolean = false): Promise<BaseBlock | any | null> {
        try {
            return await this.blockService.getBlockByHash(blockHash, network, useRawFormat);
        } catch (error) {
            logger.error(`[BlockStorage] Error getting block by hash: ${this.formatError(error)}`);
            return null;
        }
    }
    
    /**
     * Gets latest block from database or blockchain
     * If useRawFormat is true, always fetches from blockchain regardless of database presence
     * @param network Network type
     * @param useRawFormat If true, returns raw block data from blockchain
     * @returns Latest block data or null if not found
     */
    public async getLatestBlock(network: Network, useRawFormat: boolean = false): Promise<BaseBlock | any | null> {
        try {
            return await this.blockService.getLatestBlock(network, useRawFormat);
        } catch (error) {
            logger.error(`[BlockStorage] Error getting latest block: ${this.formatError(error)}`);
            return null;
        }
    }
    
    /**
     * Gets total block count from database
     */
    public async getBlockCount(network: Network): Promise<number> {
        try {
            return await this.blockService.getBlockCount(network);
        } catch (error) {
            logger.error(`[BlockStorage] Error getting block count from database: ${this.formatError(error)}`);
            return 0;
        }
    }

    /**
     * Gets latest blocks with pagination
     * @param network Network type
     * @param page Page number (1-based, default: 1)
     * @param limit Number of blocks per page (default: 50)
     * @returns Paginated blocks response
     */
    public async getLatestBlocks(
        network: Network,
        page: number = 1,
        limit: number = 50
    ): Promise<PaginatedBlocksResponse> {
        try {
            return await this.blockService.getLatestBlocks(network, page, limit);
        } catch (error) {
            logger.error(`[BlockStorage] Error getting latest blocks: ${this.formatError(error)}`);
            throw error;
        }
    }
}