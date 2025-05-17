import { Request, Response } from 'express';
import { BlockProcessorModule } from '../../../services/block-processor/BlockProcessorModule';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { BlockStorage } from '../../../services/block-processor/storage/BlockStorage';
import { TxStorage } from '../../../services/block-processor/storage/TxStorage';
import { BlockTimeService } from '../../../services/BlockTimeService';
import { FutureBlockError } from '../../../types/errors';
import { BabylonClient } from '../../../clients/BabylonClient';

/**
 * Block Processor Controller
 * Handles API requests related to block processing functionality
 */
export class BlockProcessorController {
  private blockProcessor: BlockProcessorModule;
  private blockStorage: BlockStorage;
  private txStorage: TxStorage;

  constructor() {
    this.blockProcessor = BlockProcessorModule.getInstance();
    this.blockStorage = BlockStorage.getInstance();
    this.txStorage = TxStorage.getInstance();
  }

  /**
   * Get supported networks
   */
  public getSupportedNetworks = async (req: Request, res: Response): Promise<void> => {
    try {
      const networks = this.blockProcessor.getSupportedNetworks();
      res.status(200).json({
        success: true,
        data: networks
      });
    } catch (error) {
      logger.error(`[BlockProcessorController] Error getting supported networks: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to get supported networks'
      });
    }
  };

  /**
   * Start historical sync for a specific network
   */
  public startHistoricalSync = async (req: Request, res: Response): Promise<void> => {
    try {
      const { network, fromHeight, blockCount } = req.body;
      
      if (!network) {
        res.status(400).json({
          success: false,
          error: 'Network parameter is required'
        });
        return;
      }

      // Validate network
      const supportedNetworks = this.blockProcessor.getSupportedNetworks();
      if (!supportedNetworks.includes(network as Network)) {
        res.status(400).json({
          success: false,
          error: `Network ${network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`
        });
        return;
      }

      // Start sync in background
      this.blockProcessor.startHistoricalSync(
        network as Network,
        fromHeight ? Number(fromHeight) : undefined,
        blockCount ? Number(blockCount) : undefined
      ).catch(error => {
        logger.error(`[BlockProcessorController] Error in background sync: ${error instanceof Error ? error.message : String(error)}`);
      });

      res.status(202).json({
        success: true,
        message: `Historical sync started for network ${network}`
      });
    } catch (error) {
      logger.error(`[BlockProcessorController] Error starting historical sync: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to start historical sync'
      });
    }
  };

  /**
   * Get transaction details by hash
   */
  public getTxDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { txHash } = req.params;
      const { network, raw } = req.query;
      
      if (!txHash) {
        res.status(400).json({
          success: false,
          error: 'Transaction hash is required'
        });
        return;
      }

      if (!network) {
        res.status(400).json({
          success: false,
          error: 'Network parameter is required'
        });
        return;
      }

      // Validate network
      const supportedNetworks = this.blockProcessor.getSupportedNetworks();
      if (!supportedNetworks.includes(network as Network)) {
        res.status(400).json({
          success: false,
          error: `Network ${network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`
        });
        return;
      }

      // Get transaction with optional raw format
      const useRawFormat = raw === 'true';
      const txDetails = await this.txStorage.getTxByHash(txHash, network as Network, useRawFormat);
      
      if (!txDetails) {
        res.status(404).json({
          success: false,
          error: `Transaction with hash ${txHash} not found`
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: txDetails,
        format: useRawFormat ? 'raw' : 'standard'
      });
    } catch (error) {
      logger.error(`[BlockProcessorController] Error getting transaction details: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to get transaction details'
      });
    }
  };

  /**
   * Get latest transactions with pagination
   * Supports both traditional page-based and cursor-based pagination
   */
  public getLatestTransactions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { network, cursor } = req.query;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      
      // Quick validation checks
      if (!network) {
        res.status(400).json({
          success: false,
          error: 'Network parameter is required'
        });
        return;
      }

      // Validate network - We can keep supported networks in cache
      const supportedNetworks = this.blockProcessor.getSupportedNetworks();
      if (!supportedNetworks.includes(network as Network)) {
        res.status(400).json({
          success: false,
          error: `Network ${network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`
        });
        return;
      }
      
      // Validate page and limit - Simple validations
      if (isNaN(page) || page <= 0) {
        res.status(400).json({
          success: false,
          error: 'Page must be a positive number'
        });
        return;
      }
      
      if (isNaN(limit) || limit <= 0 || limit > 100) {
        res.status(400).json({
          success: false,
          error: 'Limit must be a positive number between 1 and 100'
        });
        return;
      }
      
      // Timestamp when request started
      const startTime = Date.now();
      
      // Get latest transactions with pagination
      // Use cursor if provided, otherwise use traditional page-based pagination
      const cursorStr = cursor ? cursor.toString() : null;
      const result = await this.txStorage.getLatestTransactions(network as Network, page, limit, cursorStr);
      
      // Calculate processing duration
      const processingTime = Date.now() - startTime;
      logger.debug(`[BlockProcessorController] getLatestTransactions completed in ${processingTime}ms`);
      
      // Construct response metadata with pagination links
      const metadata: Record<string, any> = {
        processingTime: `${processingTime}ms`
      };
      
      // Set HTTP response
      res.status(200).json({
        success: true,
        data: {
          transactions: result.transactions,
          pagination: result.pagination
        },
        meta: metadata
      });
    } catch (error) {
      logger.error(`[BlockProcessorController] Error getting latest transactions: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to get latest transactions'
      });
    }
  };

  /**
   * Get block by height
   */
  public getBlockByHeight = async (req: Request, res: Response): Promise<void> => {
    try {
      const { height } = req.params;
      const { network, raw } = req.query;
      
      if (!height) {
        res.status(400).json({
          success: false,
          error: 'Block height is required'
        });
        return;
      }

      if (!network) {
        res.status(400).json({
          success: false,
          error: 'Network parameter is required'
        });
        return;
      }

      // Validate network
      const supportedNetworks = this.blockProcessor.getSupportedNetworks();
      if (!supportedNetworks.includes(network as Network)) {
        res.status(400).json({
          success: false,
          error: `Network ${network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`
        });
        return;
      }
      
      // Get block with optional raw format
      const useRawFormat = raw === 'true';
      
      try {
        const block = await this.blockStorage.getBlockByHeight(height, network as Network, useRawFormat);
        
        if (!block) {
          try {
            // Block not found in database, check if it's a future block
            const heightNum = parseInt(height.toString());
            const babylonClient = BabylonClient.getInstance();
            const currentHeight = await babylonClient.getCurrentHeight();
            
            // If the requested height is greater than current height, it's a future block
            if (heightNum > currentHeight) {
              const blockTimeService = BlockTimeService.getInstance();
              const estimate = await blockTimeService.getEstimatedTimeToBlock(heightNum);
              
              res.status(404).json({
                success: false,
                status: 'future_block',
                error: 'Block not found yet',
                message: `Block height ${heightNum} is not available yet. Current height is ${currentHeight}.`,
                data: {
                  requestedHeight: heightNum,
                  currentHeight: currentHeight,
                  blockDifference: heightNum - currentHeight,
                  estimatedTimeSeconds: estimate.estimatedSeconds,
                  estimatedTimeFormatted: this.formatTimeEstimate(estimate.estimatedSeconds || 0)
                }
              });
              return;
            }
          } catch (checkError) {
            // If checking for future block fails, just continue with standard "not found" response
            logger.debug(`[BlockProcessorController] Error checking if block ${height} is a future block: ${checkError instanceof Error ? checkError.message : String(checkError)}`);
          }
          
          // Standard "not found" response
          res.status(404).json({
            success: false,
            error: `Block at height ${height} not found`
          });
          return;
        }

        res.status(200).json({
          success: true,
          data: block,
          format: useRawFormat ? 'raw' : 'standard'
        });
      } catch (error) {
        // Check if it's a future block error
        if (error instanceof FutureBlockError) {
          // Return a special response for future blocks
          const { targetHeight, currentHeight, blockDifference, estimatedSeconds } = error.details;
        
          res.status(404).json({
            success: false,
            status: 'future_block',
            error: 'Block not found yet',
            message: error.message,
            data: {
              requestedHeight: targetHeight,
              currentHeight: currentHeight,
              blockDifference: blockDifference,
              estimatedTimeSeconds: estimatedSeconds ? Math.ceil(estimatedSeconds) : null,
              estimatedTimeFormatted: this.formatTimeEstimate(estimatedSeconds || 0)
            }
          });
          return;
        } 
        // Check if this might be a future block (not caught by error handler yet)
        else if (error instanceof Error && 
                (error.message.includes('height') || 
                 error.message.includes('SPECIAL_ERROR_HEIGHT_NOT_AVAILABLE') || 
                 error.message.includes('SPECIAL_ERROR_FUTURE_HEIGHT'))) {
          
          try {
            // Get current height from BlockTimeService
            const blockTimeService = BlockTimeService.getInstance();
            const heightNum = parseInt(height.toString());
            
            // Get current height directly from BabylonClient
            const babylonClient = BabylonClient.getInstance();
            const currentHeight = await babylonClient.getCurrentHeight();
            
            // If requested height is in the future
            if (heightNum > currentHeight) {
              // Calculate estimated time
              const estimate = await blockTimeService.getEstimatedTimeToBlock(heightNum);
              
              res.status(404).json({
                success: false,
                status: 'future_block',
                error: 'Block not found yet',
                message: `Block height ${heightNum} is not available yet. Current height is ${currentHeight}.`,
                data: {
                  requestedHeight: heightNum,
                  currentHeight: currentHeight,
                  blockDifference: heightNum - currentHeight,
                  estimatedTimeSeconds: estimate.estimatedSeconds,
                  estimatedTimeFormatted: this.formatTimeEstimate(estimate.estimatedSeconds || 0)
                }
              });
              return;
            }
          } catch (innerError) {
            logger.error(`[BlockProcessorController] Error calculating future block time: ${innerError instanceof Error ? innerError.message : String(innerError)}`);
          }
        }
        
        // If it's not a future block error or calculation failed, return generic error
        logger.error(`[BlockProcessorController] Error getting block by height: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
          success: false,
          error: 'Failed to get block by height'
        });
        return;
      }
    } catch (error) {
      logger.error(`[BlockProcessorController] Error getting block by height: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to get block by height'
      });
    }
  };

  /**
   * Format time in seconds to a human-readable string
   */
  private formatTimeEstimate(seconds: number): string {
    if (seconds <= 0) {
      return 'unknown';
    }
    
    if (seconds < 60) {
      return `approximately ${Math.ceil(seconds)} seconds`;
    } else if (seconds < 3600) {
      const minutes = Math.ceil(seconds / 60);
      return `approximately ${minutes} minutes`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.ceil((seconds % 3600) / 60);
      return `approximately ${hours} hours ${minutes > 0 ? `${minutes} minutes` : ''}`;
    }
  }

  /**
   * Get transactions by block height
   */
  public getTxsByHeight = async (req: Request, res: Response): Promise<void> => {
    try {
      const { height } = req.params;
      const { network, raw } = req.query;
      
      if (!height) {
        res.status(400).json({
          success: false,
          error: 'Block height is required'
        });
        return;
      }

      if (!network) {
        res.status(400).json({
          success: false,
          error: 'Network parameter is required'
        });
        return;
      }

      // Validate network
      const supportedNetworks = this.blockProcessor.getSupportedNetworks();
      if (!supportedNetworks.includes(network as Network)) {
        res.status(400).json({
          success: false,
          error: `Network ${network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`
        });
        return;
      }
      
      // Get transactions with optional raw format
      const useRawFormat = raw === 'true';
      const transactions = await this.txStorage.getTxsByHeight(height, network as Network, useRawFormat);

      res.status(200).json({
        success: true,
        data: transactions,
        format: useRawFormat ? 'raw' : 'standard'
      });
    } catch (error) {
      logger.error(`[BlockProcessorController] Error getting transactions by height: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to get transactions by height'
      });
    }
  };

  /**
   * Get latest block
   */
  public getLatestBlock = async (req: Request, res: Response): Promise<void> => {
    try {
      const { network, raw } = req.query;
      
      if (!network) {
        res.status(400).json({
          success: false,
          error: 'Network parameter is required'
        });
        return;
      }

      // Validate network
      const supportedNetworks = this.blockProcessor.getSupportedNetworks();
      if (!supportedNetworks.includes(network as Network)) {
        res.status(400).json({
          success: false,
          error: `Network ${network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`
        });
        return;
      }
      
      // Get latest block with optional raw format
      const useRawFormat = raw === 'true';
      const block = await this.blockStorage.getLatestBlock(network as Network, useRawFormat);
      
      if (!block) {
        res.status(404).json({
          success: false,
          error: `Latest block not found for network ${network}`
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: block,
        format: useRawFormat ? 'raw' : 'standard'
      });
    } catch (error) {
      logger.error(`[BlockProcessorController] Error getting latest block: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to get latest block'
      });
    }
  };

  /**
   * Get latest blocks with pagination
   */
  public getLatestBlocks = async (req: Request, res: Response): Promise<void> => {
    try {
      const { network } = req.query;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      
      if (!network) {
        res.status(400).json({
          success: false,
          error: 'Network parameter is required'
        });
        return;
      }

      // Validate network
      const supportedNetworks = this.blockProcessor.getSupportedNetworks();
      if (!supportedNetworks.includes(network as Network)) {
        res.status(400).json({
          success: false,
          error: `Network ${network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`
        });
        return;
      }
      
      // Validate page and limit
      if (isNaN(page) || page <= 0) {
        res.status(400).json({
          success: false,
          error: 'Page must be a positive number'
        });
        return;
      }
      
      if (isNaN(limit) || limit <= 0 || limit > 100) {
        res.status(400).json({
          success: false,
          error: 'Limit must be a positive number between 1 and 100'
        });
        return;
      }
      
      // Get latest blocks with pagination
      const result = await this.blockStorage.getLatestBlocks(network as Network, page, limit);
      
      res.status(200).json({
        success: true,
        data: {
          blocks: result.blocks,
          pagination: result.pagination
        }
      });
    } catch (error) {
      logger.error(`[BlockProcessorController] Error getting latest blocks: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to get latest blocks'
      });
    }
  };

  /**
   * Get block by hash
   */
  public getBlockByHash = async (req: Request, res: Response): Promise<void> => {
    try {
      const { hash } = req.params;
      const { network, raw } = req.query;
      
      if (!hash) {
        res.status(400).json({
          success: false,
          error: 'Block hash is required'
        });
        return;
      }

      if (!network) {
        res.status(400).json({
          success: false,
          error: 'Network parameter is required'
        });
        return;
      }

      // Validate network
      const supportedNetworks = this.blockProcessor.getSupportedNetworks();
      if (!supportedNetworks.includes(network as Network)) {
        res.status(400).json({
          success: false,
          error: `Network ${network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`
        });
        return;
      }
      
      // Get block with optional raw format
      const useRawFormat = raw === 'true';
      const block = await this.blockStorage.getBlockByHash(hash, network as Network, useRawFormat);
      
      if (!block) {
        res.status(404).json({
          success: false,
          error: `Block with hash ${hash} not found`
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: block,
        format: useRawFormat ? 'raw' : 'standard'
      });
    } catch (error) {
      logger.error(`[BlockProcessorController] Error getting block by hash: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to get block by hash'
      });
    }
  };
} 