/**
 * Block Storage Service
 * Stores block data in the database
 */

import { BaseBlock, SignatureInfo } from '../types/common';
import { IBlockStorage } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { Block, IBlock } from '../../../database/models/blockchain/Block';
import { Network } from '../../../types/finality';
import { FetcherService } from '../common/fetcher.service';
import { ValidatorInfoService } from '../../../services/validator/ValidatorInfoService';
import { Types } from 'mongoose';

/**
 * Service for storing block data
 */
export class BlockStorage implements IBlockStorage {
    private static instance: BlockStorage | null = null;
    private fetcherService: FetcherService | null = null;
    private validatorInfoService: ValidatorInfoService | null = null;
    
    private constructor() {
        // Private constructor to enforce singleton pattern
        this.initializeServices();
    }
    
    /**
     * Initialize required services
     */
    private initializeServices(): void {
        try {
            this.fetcherService = FetcherService.getInstance();
        } catch (error) {
            logger.warn(`[BlockStorage] FetcherService initialization failed: ${this.formatError(error)}`);
        }
        
        try {
            this.validatorInfoService = ValidatorInfoService.getInstance();
        } catch (error) {
            logger.warn(`[BlockStorage] ValidatorInfoService initialization failed: ${this.formatError(error)}`);
        }
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
            
            logger.debug(`[BlockStorage] Block saved to database: ${block.height}`);
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
            // If raw format is requested, always fetch from blockchain
            if (useRawFormat) {
                return await this.fetchRawBlockByHeight(height, network);
            }
            
            // For standard format, first try to get from database
            const block = await this.findBlockInDatabase({ height: height.toString(), network });
            
            if (block) {
                return this.mapToBaseBlock(block);
            }
            
            // If not found in database, try to fetch from blockchain
            return await this.fetchAndSaveBlockByHeight(height, network);
        } catch (error) {
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
            // If raw format is requested, always fetch from blockchain
            if (useRawFormat) {
                return await this.fetchRawBlockByHash(blockHash, network);
            }
            
            // For standard format, first try to get from database
            const block = await this.findBlockInDatabase({ blockHash, network });
            
            if (block) {
                return this.mapToBaseBlock(block);
            }
            
            // If not found in database, try to fetch from blockchain
            return await this.fetchAndSaveBlockByHash(blockHash, network);
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
            // If raw format is requested, always fetch from blockchain
            if (useRawFormat) {
                return await this.fetchRawLatestBlock(network);
            }
            
            // For standard format, first try to get from database
            const block = await this.findLatestBlockInDatabase(network);
            
            if (block) {
                return this.mapToBaseBlock(block);
            }
            
            // If not found in database, try to fetch from blockchain
            return await this.fetchAndSaveLatestBlock(network);
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
            return await Block.countDocuments({ network: network });
        } catch (error) {
            logger.error(`[BlockStorage] Error getting block count from database: ${this.formatError(error)}`);
            return 0;
        }
    }
    
    /**
     * Find a block in the database with the given query
     */
    private async findBlockInDatabase(query: Record<string, any>): Promise<IBlock | null> {
        return Block.findOne(query)
            .populate('proposer', 'moniker valoper_address logo_url')
            .populate('signatures.validator', 'moniker valoper_address logo_url');
    }
    
    /**
     * Find the latest block in the database for a given network
     */
    private async findLatestBlockInDatabase(network: Network): Promise<IBlock | null> {
        return Block.findOne({ network })
            .sort({ height: -1 })
            .populate('proposer', 'moniker valoper_address logo_url')
            .populate('signatures.validator', 'moniker valoper_address logo_url');
    }
    
    /**
     * Fetch raw block by height from blockchain
     */
    private async fetchRawBlockByHeight(height: string | number, network: Network): Promise<any | null> {
        if (!this.fetcherService) {
            logger.error(`[BlockStorage] Raw format requested but FetcherService is not available`);
            return null;
        }
        
        logger.info(`[BlockStorage] Raw format requested for block at height ${height}, fetching from blockchain`);
        
        if (typeof (this.fetcherService as any).fetchBlockByHeight === 'function') {
            try {
                return await (this.fetcherService as any).fetchBlockByHeight(height, network);
            } catch (error) {
                logger.error(`[BlockStorage] Error fetching block by height: ${this.formatError(error)}`);
                return null;
            }
        } else {
            logger.error(`[BlockStorage] fetchBlockByHeight method not implemented in FetcherService`);
            return null;
        }
    }
    
    /**
     * Fetch raw block by hash from blockchain
     */
    private async fetchRawBlockByHash(blockHash: string, network: Network): Promise<any | null> {
        if (!this.fetcherService) {
            logger.error(`[BlockStorage] Raw format requested but FetcherService is not available`);
            return null;
        }
        
        logger.info(`[BlockStorage] Raw format requested for block with hash ${blockHash}, fetching from blockchain`);
        
        if (typeof (this.fetcherService as any).fetchBlockByHash === 'function') {
            try {
                return await (this.fetcherService as any).fetchBlockByHash(blockHash, network);
            } catch (error) {
                logger.error(`[BlockStorage] Error fetching block by hash: ${this.formatError(error)}`);
                return null;
            }
        } else {
            logger.error(`[BlockStorage] fetchBlockByHash method not implemented in FetcherService`);
            return null;
        }
    }
    
    /**
     * Fetch raw latest block from blockchain
     */
    private async fetchRawLatestBlock(network: Network): Promise<any | null> {
        if (!this.fetcherService) {
            logger.error(`[BlockStorage] Raw format requested but FetcherService is not available`);
            return null;
        }
        
        logger.info(`[BlockStorage] Raw format requested for latest block, fetching from blockchain`);
        
        if (typeof (this.fetcherService as any).fetchLatestBlock === 'function') {
            try {
                return await (this.fetcherService as any).fetchLatestBlock(network);
            } catch (error) {
                logger.error(`[BlockStorage] Error fetching latest block: ${this.formatError(error)}`);
                return null;
            }
        } else {
            logger.error(`[BlockStorage] fetchLatestBlock method not implemented in FetcherService`);
            return null;
        }
    }
    
    /**
     * Fetch block by height from blockchain, convert to BaseBlock, save to database, and return
     */
    private async fetchAndSaveBlockByHeight(height: string | number, network: Network): Promise<BaseBlock | any | null> {
        if (!this.fetcherService || typeof (this.fetcherService as any).fetchBlockByHeight !== 'function') {
            return null;
        }
        
        logger.info(`[BlockStorage] Block at height ${height} not found in storage, fetching from blockchain`);
        
        try {
            const blockDetails = await (this.fetcherService as any).fetchBlockByHeight(height, network);
            
            if (!blockDetails) {
                return null;
            }
            
            return await this.processAndSaveRawBlock(blockDetails, network);
        } catch (error) {
            logger.error(`[BlockStorage] Error fetching block by height: ${this.formatError(error)}`);
            return null;
        }
    }
    
    /**
     * Fetch block by hash from blockchain, convert to BaseBlock, save to database, and return
     */
    private async fetchAndSaveBlockByHash(blockHash: string, network: Network): Promise<BaseBlock | any | null> {
        if (!this.fetcherService || typeof (this.fetcherService as any).fetchBlockByHash !== 'function') {
            return null;
        }
        
        logger.info(`[BlockStorage] Block with hash ${blockHash} not found in storage, fetching from blockchain`);
        
        try {
            const blockDetails = await (this.fetcherService as any).fetchBlockByHash(blockHash, network);
            
            if (!blockDetails) {
                return null;
            }
            
            return await this.processAndSaveRawBlock(blockDetails, network);
        } catch (error) {
            logger.error(`[BlockStorage] Error fetching block by hash: ${this.formatError(error)}`);
            return null;
        }
    }
    
    /**
     * Fetch latest block from blockchain, convert to BaseBlock, save to database, and return
     */
    private async fetchAndSaveLatestBlock(network: Network): Promise<BaseBlock | any | null> {
        if (!this.fetcherService || typeof (this.fetcherService as any).fetchLatestBlock !== 'function') {
            return null;
        }
        
        logger.info(`[BlockStorage] Latest block not found in storage, fetching from blockchain`);
        
        try {
            const blockDetails = await (this.fetcherService as any).fetchLatestBlock(network);
            
            if (!blockDetails) {
                return null;
            }
            
            return await this.processAndSaveRawBlock(blockDetails, network);
        } catch (error) {
            logger.error(`[BlockStorage] Error fetching latest block: ${this.formatError(error)}`);
            return null;
        }
    }
    
    /**
     * Process raw block data, convert to BaseBlock, save to database, and return
     */
    private async processAndSaveRawBlock(blockDetails: any, network: Network): Promise<BaseBlock | any> {
        try {
            const baseBlock = await this.convertRawBlockToBaseBlock(blockDetails, network);
            await this.saveBlock(baseBlock, network);
            
            // Fetch the saved block with populated fields
            const savedBlock = await this.findBlockInDatabase({ 
                blockHash: baseBlock.blockHash, 
                network 
            });
            
            if (savedBlock) {
                return this.mapToBaseBlock(savedBlock);
            }
            
            return baseBlock;
        } catch (error) {
            logger.error(`[BlockStorage] Error processing raw block: ${this.formatError(error)}`);
            // Return raw data as fallback
            return blockDetails;
        }
    }
    
    /**
     * Maps IBlock model to BaseBlock
     * Preserves populated fields for API responses
     */
    private mapToBaseBlock(block: IBlock): BaseBlock {
        return {
            height: block.height,
            blockHash: block.blockHash,
            proposer: block.proposer, // This will include only moniker, valoper_address and logo_url
            numTxs: block.numTxs,
            time: block.time,
            signatures: block.signatures.map(sig => ({
                validator: sig.validator, // This will include only moniker, valoper_address and logo_url
                timestamp: sig.timestamp,
            })),
            appHash: block.appHash,
            totalGasWanted: block.totalGasWanted || "0",
            totalGasUsed: block.totalGasUsed || "0"
        };
    }
    
    /**
     * Converts raw block data from blockchain to BaseBlock format
     * This is a simplified implementation and may need to be adjusted based on actual data structure
     */
    private async convertRawBlockToBaseBlock(rawBlock: any, network: Network): Promise<BaseBlock> {
        try {
            const result = rawBlock.result;
            // Extract basic information
            const height = result.block?.header?.height?.toString() || '0';
            const blockHash = result.block_id?.hash || '';
            const time = result.block?.header?.time || new Date().toISOString();
            const appHash = result.block?.header?.app_hash || '';
            
            // Extract proposer information
            const proposerAddress = result.block?.header?.proposer_address || '';
            
            // Try to find validator by hex address
            // Default to a new ObjectId if validator not found
            let proposerId = new Types.ObjectId();
            
            if (this.validatorInfoService && proposerAddress) {
                try {
                    // Try to find validator by hex address
                    const validator = await this.validatorInfoService.getValidatorByHexAddress(
                        proposerAddress,
                        network
                    );
                    
                    if (validator && validator._id) {
                        proposerId = validator._id;
                    } else {
                        logger.warn(`[BlockStorage] Validator not found for proposer address: ${proposerAddress}`);
                    }
                } catch (error) {
                    logger.error(`[BlockStorage] Error finding validator for proposer: ${this.formatError(error)}`);
                }
            }
            
            // Extract transaction count
            const numTxs = result.block?.data?.txs?.length || 0;
            
            // Extract gas information
            const totalGasWanted = result.result_finalize_block?.validator_updates?.gas_wanted?.toString() || '0';
            const totalGasUsed = result.result_finalize_block?.validator_updates?.gas_used?.toString() || '0';
            
            // Extract signatures
            const signatures = await this.extractSignatures(result, network, time);
            
            return {
                height,
                blockHash,
                proposer: proposerId,
                numTxs,
                time,
                signatures,
                appHash,
                totalGasWanted,
                totalGasUsed
            };
        } catch (error) {
            logger.error(`[BlockStorage] Error converting raw block to BaseBlock: ${this.formatError(error)}`);
            throw new Error(`Failed to convert raw block: ${this.formatError(error)}`);
        }
    }
    
    /**
     * Extract signatures from raw block data
     */
    private async extractSignatures(result: any, network: Network, defaultTime: string): Promise<SignatureInfo[]> {
        const signatures: SignatureInfo[] = [];
        
        // If there are signatures in the raw block, try to convert them
        if (result.block?.last_commit?.signatures) {
            for (const sig of result.block.last_commit.signatures) {
                if (sig.validator_address) {
                    // Default to a new ObjectId if validator not found
                    let validatorId = new Types.ObjectId();
                    
                    // Try to find validator by hex address
                    if (this.validatorInfoService) {
                        try {
                            const validator = await this.validatorInfoService.getValidatorByHexAddress(
                                sig.validator_address,
                                network
                            );
                            
                            if (validator && validator._id) {
                                validatorId = validator._id;
                            }
                        } catch (error) {
                            logger.error(`[BlockStorage] Error finding validator for signature: ${this.formatError(error)}`);
                        }
                    }
                    
                    signatures.push({
                        validator: validatorId,
                        timestamp: sig.timestamp || defaultTime
                    });
                }
            }
        }
        
        return signatures;
    }
}