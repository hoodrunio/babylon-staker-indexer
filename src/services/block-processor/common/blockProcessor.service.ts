/**
 * Block processing service
 */

import { BaseBlock, BlockProcessorError, SignatureInfo, WebsocketBlockEvent } from '../types/common';
import { IBlockProcessorService, IBlockStorage } from '../types/interfaces';
import { Network } from '../../../types/finality';
import { BabylonClient } from '../../../clients/BabylonClient';
import { logger } from '../../../utils/logger';
import { ValidatorInfoService } from '../../validator/ValidatorInfoService';
import { Types } from 'mongoose';

export class BlockProcessorService implements IBlockProcessorService {
  private network: Network;
  private babylonClient: BabylonClient;
  private validatorInfoService: ValidatorInfoService;

  constructor(
    private readonly blockStorage: IBlockStorage, 
    network: Network = Network.TESTNET,
    babylonClient?: BabylonClient
  ) {
    this.network = network;
    this.babylonClient = babylonClient || BabylonClient.getInstance(network);
    this.validatorInfoService = ValidatorInfoService.getInstance();
  }

  /**
   * Process block data from JSON RPC
   */
  async processBlock(blockData: any): Promise<BaseBlock> {
    try {
      this.validateBlockData(blockData);
      
      const header = blockData.header;
      const proposerValidator = await this.getProposerValidator(header.proposer_address);
      const signatures = await this.processSignatures(blockData.last_commit?.signatures || []);
      const height = parseInt(header.height);
      
      // Get block hash info
      await this.enrichBlockWithHash(blockData, height);
      const blockhash = blockData.block_id?.hash || '';
      
      // Calculate gas values
      const { totalGasWanted, totalGasUsed } = this.calculateTotalGasValues(blockData);
      
      const baseBlock = this.createBaseBlock(
        header, 
        blockhash, 
        proposerValidator._id, 
        blockData, 
        signatures,
        totalGasWanted,
        totalGasUsed
      );

      // Save to database
      await this.blockStorage.saveBlock(baseBlock, this.network);
      
      // Summary log
      logger.info(`[BlockProcessorService] Processed block at height ${baseBlock.height} with ${baseBlock.numTxs} transactions, total gas wanted: ${totalGasWanted}, total gas used: ${totalGasUsed}`);
      
      return baseBlock;
    } catch (error) {
      return this.handleProcessingError(error, 'Block processing error');
    }
  }

  /**
   * Process block data from websocket
   */
  async processBlockFromWebsocket(blockEvent: WebsocketBlockEvent): Promise<BaseBlock> {
    try {
      // Check block data
      if (!blockEvent?.data?.value?.block) {
        throw new BlockProcessorError('Block data is missing in websocket event');
      }

      const blockData = blockEvent.data.value.block;
      this.validateBlockData(blockData);
      
      const height = parseInt(blockData.header.height);
      
      // Get block hash info
      await this.enrichBlockWithHash(blockData, height);
      
      // Calculate gas values (if result_finalize_block exists in websocket event)
      const { totalGasWanted, totalGasUsed } = this.calculateTotalGasValues(
        blockEvent.data.value
      );
      
      // Add gas values to blockData object
      blockData.total_gas_wanted = totalGasWanted;
      blockData.total_gas_used = totalGasUsed;
      
      return this.processBlock(blockData);
    } catch (error) {
      return this.handleProcessingError(error, 'Websocket block processing error');
    }
  }

  
  /**
   * Get proposer validator info
   */
  private async getProposerValidator(proposerAddress: string): Promise<any> {
    const proposerValidator = await this.validatorInfoService.getValidatorByHexAddress(
      proposerAddress, 
      this.network
    );
    
    if (!proposerValidator) {
      throw new BlockProcessorError(`Proposer validator not found: ${proposerAddress}`);
    }
    
    return proposerValidator;
  }

  /**
   * Process signatures and return valid ones
   */
  private async processSignatures(signatures: any[]): Promise<SignatureInfo[]> {
    const signaturesPromises = signatures.map(async (sig: any) => {
      if (!sig.validator_address) {
        return null; // Skip invalid signatures
      }
      
      const validator = await this.validatorInfoService.getValidatorByHexAddress(
        sig.validator_address, 
        this.network
      );
      
      if (!validator) {
        return null; // Skip if validator not found
      }
      
      // Convert to SignatureInfo type
      return {
        validator: validator._id,
        timestamp: sig.timestamp || ''
      };
    });
    
    // Resolve promises and filter out nulls
    const results = await Promise.all(signaturesPromises);
    return results.filter((sig): sig is SignatureInfo => sig !== null);
  }

  /**
   * Add hash info to block data
   */
  private async enrichBlockWithHash(blockData: any, height: number): Promise<void> {
    const response = await this.babylonClient.getBlockByHeight(height);
    
    if (response) {
      // Add hash value
      const hash = response.result.block_id.hash;
      blockData.block_id = {
        hash: hash
      };
    } else {
      throw new BlockProcessorError(`Could not get block hash info: ${height}`);
    }
  }

  /**
   * Calculate total gas values
   */
  private calculateTotalGasValues(blockData: any): { totalGasWanted: string, totalGasUsed: string } {
    let totalGasWanted = 0;
    let totalGasUsed = 0;
    
    // If total_gas_wanted and total_gas_used are already present in blockData, use them
    if (blockData.total_gas_wanted !== undefined && blockData.total_gas_used !== undefined) {
      return {
        totalGasWanted: blockData.total_gas_wanted.toString(),
        totalGasUsed: blockData.total_gas_used.toString()
      };
    }
    
    // Check result_finalize_block for tx_results
    const txResults = blockData.result_finalize_block?.tx_results || [];
    
    if (Array.isArray(txResults) && txResults.length > 0) {
      // Sum up gas values from each transaction
      txResults.forEach((txResult: any) => {
        if (txResult) {
          const gasWanted = parseInt(txResult.gas_wanted || '0');
          const gasUsed = parseInt(txResult.gas_used || '0');
          
          if (!isNaN(gasWanted)) {
            totalGasWanted += gasWanted;
          }
          
          if (!isNaN(gasUsed)) {
            totalGasUsed += gasUsed;
          }
        }
      });
    }
    
    return {
      totalGasWanted: totalGasWanted.toString(),
      totalGasUsed: totalGasUsed.toString()
    };
  }

  /**
   * Create BaseBlock object
   */
  private createBaseBlock(
    header: any, 
    blockhash: string, 
    proposerId: Types.ObjectId, 
    blockData: any, 
    signatures: SignatureInfo[],
    totalGasWanted: string,
    totalGasUsed: string
  ): BaseBlock {
    return {
      height: header.height,
      blockHash: blockhash,
      proposer: proposerId,
      numTxs: Array.isArray(blockData.data?.txs) ? blockData.data.txs.length : 0,
      time: header.time,
      signatures,
      appHash: header.app_hash,
      totalGasWanted,
      totalGasUsed
    };
  }

  /**
   * Handle processing errors
   */
  private handleProcessingError(error: unknown, prefix: string): never {
    if (error instanceof BlockProcessorError) {
      throw error;
    }
    throw new BlockProcessorError(
      `${prefix}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Get block by height
   */
  async getBlockByHeight(height: string | number): Promise<BaseBlock | null> {
    return this.blockStorage.getBlockByHeight(height, this.network);
  }
  
  /**
   * Get block by hash
   */
  async getBlockByHash(blockHash: string): Promise<BaseBlock | null> {
    return this.blockStorage.getBlockByHash(blockHash, this.network);
  }

  /**
   * Set network value
   */
  setNetwork(network: Network): void {
    this.network = network;
    this.babylonClient = BabylonClient.getInstance(network);
  }

  /**
   * Get current network value
   */
  getNetwork(): Network {
    return this.network;
  }

  /**
   * Validate block data
   */
  private validateBlockData(blockData: any): void {
    if (!blockData?.header) {
      throw new BlockProcessorError('Block header not found');
    }
  }

} 