import { Request, Response } from 'express';
import { BlockProcessorModule } from '../../services/block-processor/BlockProcessorModule';
import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { BlockStorage } from '../../services/block-processor/storage/BlockStorage';
import { TxStorage } from '../../services/block-processor/storage/TxStorage';

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
   */
  public getLatestTransactions = async (req: Request, res: Response): Promise<void> => {
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
      
      // Get latest transactions with pagination
      const result = await this.txStorage.getLatestTransactions(network as Network, page, limit);
      
      res.status(200).json({
        success: true,
        data: {
          transactions: result.transactions,
          pagination: result.pagination
        }
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
      const block = await this.blockStorage.getBlockByHeight(height, network as Network, useRawFormat);
      
      if (!block) {
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
      logger.error(`[BlockProcessorController] Error getting block by height: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({
        success: false,
        error: 'Failed to get block by height'
      });
    }
  };

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