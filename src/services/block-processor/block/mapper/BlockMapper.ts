/**
 * Block Mapper
 * Handles mapping between different block data formats
 */

import { BaseBlock, SignatureInfo, SimpleBlock } from '../../types/common';
import { IBlock } from '../../../../database/models/blockchain/Block';
import { logger } from '../../../../utils/logger';
import { Network } from '../../../../types/finality';
import { Types } from 'mongoose';
import { IValidatorInfoAdapter } from '../service/IValidatorInfoAdapter';

export class BlockMapper {
  /**
   * Maps IBlock model to BaseBlock
   * Preserves populated fields for API responses
   */
  public static mapToBaseBlock(block: IBlock): BaseBlock {
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
   * Maps IBlock to SimpleBlock
   */
  public static mapToSimpleBlock(block: IBlock): SimpleBlock {
    return {
      height: block.height,
      blockHash: block.blockHash,
      proposer: block.proposer, // This will be the populated validator info
      numTxs: block.numTxs,
      time: block.time
    };
  }
  
  /**
   * Converts raw block data from blockchain to BaseBlock format
   * This is a simplified implementation and may need to be adjusted based on actual data structure
   */
  public static async convertRawBlockToBaseBlock(
    rawBlock: any, 
    network: Network,
    validatorInfoAdapter: IValidatorInfoAdapter
  ): Promise<BaseBlock> {
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
      
      if (validatorInfoAdapter && proposerAddress) {
        try {
          // Try to find validator by hex address
          const validator = await validatorInfoAdapter.getValidatorByHexAddress(
            proposerAddress,
            network
          );
          
          if (validator && validator._id) {
            proposerId = validator._id;
          } else {
            logger.warn(`[BlockMapper] Validator not found for proposer address: ${proposerAddress}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`[BlockMapper] Error finding validator for proposer: ${errorMessage}`);
        }
      }
      
      // Extract transaction count
      const numTxs = result.block?.data?.txs?.length || 0;
      
      // Extract gas information
      const totalGasWanted = result.result_finalize_block?.validator_updates?.gas_wanted?.toString() || '0';
      const totalGasUsed = result.result_finalize_block?.validator_updates?.gas_used?.toString() || '0';
      
      // Extract signatures
      const signatures = await BlockMapper.extractSignatures(result, network, time, validatorInfoAdapter);
      
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[BlockMapper] Error converting raw block to BaseBlock: ${errorMessage}`);
      throw new Error(`Failed to convert raw block: ${errorMessage}`);
    }
  }
  
  /**
   * Extract signatures from raw block data
   */
  private static async extractSignatures(
    result: any, 
    network: Network, 
    defaultTime: string,
    validatorInfoAdapter: IValidatorInfoAdapter
  ): Promise<SignatureInfo[]> {
    const signatures: SignatureInfo[] = [];
    
    // If there are signatures in the raw block, try to convert them
    if (result.block?.last_commit?.signatures) {
      for (const sig of result.block.last_commit.signatures) {
        if (sig.validator_address) {
          // Default to a new ObjectId if validator not found
          let validatorId = new Types.ObjectId();
          
          // Try to find validator by hex address
          if (validatorInfoAdapter) {
            try {
              const validator = await validatorInfoAdapter.getValidatorByHexAddress(
                sig.validator_address,
                network
              );
              
              if (validator && validator._id) {
                validatorId = validator._id;
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              logger.error(`[BlockMapper] Error finding validator for signature: ${errorMessage}`);
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