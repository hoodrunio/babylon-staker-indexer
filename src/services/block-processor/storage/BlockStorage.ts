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
        try {
            this.fetcherService = FetcherService.getInstance();
        } catch (error) {
            logger.warn(`[BlockStorage] FetcherService initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        try {
            this.validatorInfoService = ValidatorInfoService.getInstance();
        } catch (error) {
            logger.warn(`[BlockStorage] ValidatorInfoService initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
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
            logger.error(`[BlockStorage] Error saving block to database: ${error instanceof Error ? error.message : String(error)}`);
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
                if (!this.fetcherService) {
                    logger.error(`[BlockStorage] Raw format requested but FetcherService is not available`);
                    return null;
                }
                
                logger.info(`[BlockStorage] Raw format requested for block at height ${height}, fetching from blockchain`);
                
                // This requires implementation in FetcherService to get block by height
                // For now, we'll check if the method exists and call it
                if (typeof (this.fetcherService as any).fetchBlockByHeight === 'function') {
                    try {
                        const blockDetails = await (this.fetcherService as any).fetchBlockByHeight(height, network);
                        return blockDetails;
                    } catch (error) {
                        logger.error(`[BlockStorage] Error fetching block by height: ${error instanceof Error ? error.message : String(error)}`);
                        return null;
                    }
                } else {
                    logger.error(`[BlockStorage] fetchBlockByHeight method not implemented in FetcherService`);
                    return null;
                }
            }
            
            // For standard format, first try to get from database
            const block = await Block.findOne({ 
                height: height.toString(), 
                network: network 
            })
            .populate('proposer', 'moniker valoper_address logo_url')
            .populate('signatures.validator', 'moniker valoper_address logo_url');
            
            if (block) {
                return this.mapToBaseBlock(block);
            }
            
            // If not found in database and fetcherService is available, try to fetch from blockchain
            if (this.fetcherService && typeof (this.fetcherService as any).fetchBlockByHeight === 'function') {
                logger.info(`[BlockStorage] Block at height ${height} not found in storage, fetching from blockchain`);
                try {
                    const blockDetails = await (this.fetcherService as any).fetchBlockByHeight(height, network);
                    
                    if (!blockDetails) {
                        return null;
                    }
                    
                    // Convert to BaseBlock format and save to database
                    try {
                        const baseBlock = await this.convertRawBlockToBaseBlock(blockDetails, network);
                        await this.saveBlock(baseBlock, network);
                        
                        // Fetch the saved block with populated fields
                        const savedBlock = await Block.findOne({ 
                            height: baseBlock.height, 
                            network: network 
                        })
                        .populate('proposer', 'moniker valoper_address logo_url')
                        .populate('signatures.validator', 'moniker valoper_address logo_url');
                        
                        if (savedBlock) {
                            return this.mapToBaseBlock(savedBlock);
                        }
                        
                        return baseBlock;
                    } catch (error) {
                        logger.error(`[BlockStorage] Error converting raw block to BaseBlock: ${error instanceof Error ? error.message : String(error)}`);
                        // Return raw data as fallback
                        return blockDetails;
                    }
                } catch (error) {
                    logger.error(`[BlockStorage] Error fetching block by height: ${error instanceof Error ? error.message : String(error)}`);
                    return null;
                }
            }
            
            return null;
        } catch (error) {
            logger.error(`[BlockStorage] Error getting block by height: ${error instanceof Error ? error.message : String(error)}`);
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
                if (!this.fetcherService) {
                    logger.error(`[BlockStorage] Raw format requested but FetcherService is not available`);
                    return null;
                }
                
                logger.info(`[BlockStorage] Raw format requested for block with hash ${blockHash}, fetching from blockchain`);
                
                // This requires implementation in FetcherService to get block by hash
                // For now, we'll check if the method exists and call it
                if (typeof (this.fetcherService as any).fetchBlockByHash === 'function') {
                    try {
                        const blockDetails = await (this.fetcherService as any).fetchBlockByHash(blockHash, network);
                        return blockDetails;
                    } catch (error) {
                        logger.error(`[BlockStorage] Error fetching block by hash: ${error instanceof Error ? error.message : String(error)}`);
                        return null;
                    }
                } else {
                    logger.error(`[BlockStorage] fetchBlockByHash method not implemented in FetcherService`);
                    return null;
                }
            }
            
            // For standard format, first try to get from database
            const block = await Block.findOne({ 
                blockHash: blockHash, 
                network: network 
            })
            .populate('proposer', 'moniker valoper_address logo_url')
            .populate('signatures.validator', 'moniker valoper_address logo_url');
            
            if (block) {
                return this.mapToBaseBlock(block);
            }
            
            // If not found in database and fetcherService is available, try to fetch from blockchain
            if (this.fetcherService && typeof (this.fetcherService as any).fetchBlockByHash === 'function') {
                logger.info(`[BlockStorage] Block with hash ${blockHash} not found in storage, fetching from blockchain`);
                try {
                    const blockDetails = await (this.fetcherService as any).fetchBlockByHash(blockHash, network);
                    
                    if (!blockDetails) {
                        return null;
                    }
                    
                    // Convert to BaseBlock format and save to database
                    try {
                        const baseBlock = await this.convertRawBlockToBaseBlock(blockDetails, network);
                        await this.saveBlock(baseBlock, network);
                        
                        // Fetch the saved block with populated fields
                        const savedBlock = await Block.findOne({ 
                            blockHash: baseBlock.blockHash, 
                            network: network 
                        })
                        .populate('proposer', 'moniker valoper_address logo_url')
                        .populate('signatures.validator', 'moniker valoper_address logo_url');
                        
                        if (savedBlock) {
                            return this.mapToBaseBlock(savedBlock);
                        }
                        
                        return baseBlock;
                    } catch (error) {
                        logger.error(`[BlockStorage] Error converting raw block to BaseBlock: ${error instanceof Error ? error.message : String(error)}`);
                        // Return raw data as fallback
                        return blockDetails;
                    }
                } catch (error) {
                    logger.error(`[BlockStorage] Error fetching block by hash: ${error instanceof Error ? error.message : String(error)}`);
                    return null;
                }
            }
            
            return null;
        } catch (error) {
            logger.error(`[BlockStorage] Error getting block by hash: ${error instanceof Error ? error.message : String(error)}`);
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
                if (!this.fetcherService) {
                    logger.error(`[BlockStorage] Raw format requested but FetcherService is not available`);
                    return null;
                }
                
                logger.info(`[BlockStorage] Raw format requested for latest block, fetching from blockchain`);
                
                // This requires implementation in FetcherService to get latest block
                // For now, we'll check if the method exists and call it
                if (typeof (this.fetcherService as any).fetchLatestBlock === 'function') {
                    try {
                        const blockDetails = await (this.fetcherService as any).fetchLatestBlock(network);
                        return blockDetails;
                    } catch (error) {
                        logger.error(`[BlockStorage] Error fetching latest block: ${error instanceof Error ? error.message : String(error)}`);
                        return null;
                    }
                } else {
                    logger.error(`[BlockStorage] fetchLatestBlock method not implemented in FetcherService`);
                    return null;
                }
            }
            
            // For standard format, first try to get from database
            const block = await Block.findOne({ 
                network: network 
            })
            .sort({ height: -1 })
            .populate('proposer', 'moniker valoper_address logo_url')
            .populate('signatures.validator', 'moniker valoper_address logo_url');
            
            if (block) {
                return this.mapToBaseBlock(block);
            }
            
            // If not found in database and fetcherService is available, try to fetch from blockchain
            if (this.fetcherService && typeof (this.fetcherService as any).fetchLatestBlock === 'function') {
                logger.info(`[BlockStorage] Latest block not found in storage, fetching from blockchain`);
                try {
                    const blockDetails = await (this.fetcherService as any).fetchLatestBlock(network);
                    
                    if (!blockDetails) {
                        return null;
                    }
                    
                    // Convert to BaseBlock format and save to database
                    try {
                        const baseBlock = await this.convertRawBlockToBaseBlock(blockDetails, network);
                        await this.saveBlock(baseBlock, network);
                        
                        // Fetch the saved block with populated fields
                        const savedBlock = await Block.findOne({ 
                            blockHash: baseBlock.blockHash, 
                            network: network 
                        })
                        .populate('proposer', 'moniker valoper_address logo_url')
                        .populate('signatures.validator', 'moniker valoper_address logo_url');
                        
                        if (savedBlock) {
                            return this.mapToBaseBlock(savedBlock);
                        }
                        
                        return baseBlock;
                    } catch (error) {
                        logger.error(`[BlockStorage] Error converting raw block to BaseBlock: ${error instanceof Error ? error.message : String(error)}`);
                        // Return raw data as fallback
                        return blockDetails;
                    }
                } catch (error) {
                    logger.error(`[BlockStorage] Error fetching latest block: ${error instanceof Error ? error.message : String(error)}`);
                    return null;
                }
            }
            
            return null;
        } catch (error) {
            logger.error(`[BlockStorage] Error getting latest block: ${error instanceof Error ? error.message : String(error)}`);
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
            logger.error(`[BlockStorage] Error getting block count from database: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
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
                    logger.error(`[BlockStorage] Error finding validator for proposer: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            
            // Extract transaction count
            const numTxs = result.block?.data?.txs?.length || 0;
            
            // Extract gas information
            const totalGasWanted = result.result_finalize_block?.validator_updates?.gas_wanted?.toString() || '0';
            const totalGasUsed = result.result_finalize_block?.validator_updates?.gas_used?.toString() || '0';
            
            // Extract signatures (this might need to be looked up in the database)
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
                                logger.error(`[BlockStorage] Error finding validator for signature: ${error instanceof Error ? error.message : String(error)}`);
                            }
                        }
                        
                        signatures.push({
                            validator: validatorId,
                            timestamp: sig.timestamp || time
                        });
                    }
                }
            }
            
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
            logger.error(`[BlockStorage] Error converting raw block to BaseBlock: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error(`Failed to convert raw block: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}