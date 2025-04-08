/**
 * Block Fetcher Adapter
 * Adapts FetcherService to IBlockFetcherAdapter interface
 */

import { IBlockFetcherAdapter } from './IBlockFetcherAdapter';
import { FetcherService } from '../../common/fetcher.service';
import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';

export class BlockFetcherAdapter implements IBlockFetcherAdapter {
  private static instance: BlockFetcherAdapter | null = null;
  private fetcherService: FetcherService | null = null;
  
  private constructor() {
    // Private constructor to enforce singleton pattern
    this.initializeFetcherService();
  }
  
  /**
   * Initialize fetcher service
   */
  private initializeFetcherService(): void {
    try {
      this.fetcherService = FetcherService.getInstance();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`[BlockFetcherAdapter] FetcherService initialization failed: ${errorMessage}`);
    }
  }
  
  /**
   * Singleton instance
   */
  public static getInstance(): BlockFetcherAdapter {
    if (!BlockFetcherAdapter.instance) {
      BlockFetcherAdapter.instance = new BlockFetcherAdapter();
    }
    return BlockFetcherAdapter.instance;
  }
  
  /**
   * Format error message consistently
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  
  /**
   * Fetches block by height
   */
  public async fetchBlockByHeight(height: string | number, network: Network): Promise<any> {
    if (!this.fetcherService) {
      logger.error(`[BlockFetcherAdapter] FetcherService is not available`);
      return null;
    }
    
    try {
      return await this.fetcherService.fetchBlockByHeight(height, network);
    } catch (error) {
      logger.error(`[BlockFetcherAdapter] Error fetching block by height: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Fetches block by hash
   */
  public async fetchBlockByHash(blockHash: string, network: Network): Promise<any> {
    if (!this.fetcherService) {
      logger.error(`[BlockFetcherAdapter] FetcherService is not available`);
      return null;
    }
    
    try {
      return await this.fetcherService.fetchBlockByHash(blockHash, network);
    } catch (error) {
      logger.error(`[BlockFetcherAdapter] Error fetching block by hash: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Fetches latest block
   */
  public async fetchLatestBlock(network: Network): Promise<any> {
    if (!this.fetcherService) {
      logger.error(`[BlockFetcherAdapter] FetcherService is not available`);
      return null;
    }
    
    try {
      return await this.fetcherService.fetchLatestBlock(network);
    } catch (error) {
      logger.error(`[BlockFetcherAdapter] Error fetching latest block: ${this.formatError(error)}`);
      return null;
    }
  }

  /**
   * Checks if a network is configured
   */
  public isNetworkConfigured(network: Network): boolean {
    if (!this.fetcherService) {
      logger.error(`[BlockFetcherAdapter] FetcherService is not available`);
      return false;
    }
    
    try {
      const supportedNetworks = this.fetcherService.getSupportedNetworks();
      return supportedNetworks.includes(network);
    } catch (error) {
      logger.error(`[BlockFetcherAdapter] Error checking if network is configured: ${this.formatError(error)}`);
      return false;
    }
  }
} 