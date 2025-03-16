/**
 * Fetcher Adapter
 * Adapts FetcherService to IFetcherAdapter interface
 */

import { IFetcherAdapter } from './IFetcherAdapter';
import { FetcherService } from '../../common/fetcher.service';
import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';

export class FetcherAdapter implements IFetcherAdapter {
  private static instance: FetcherAdapter | null = null;
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
      logger.warn(`[FetcherAdapter] FetcherService initialization failed: ${errorMessage}`);
    }
  }
  
  /**
   * Singleton instance
   */
  public static getInstance(): FetcherAdapter {
    if (!FetcherAdapter.instance) {
      FetcherAdapter.instance = new FetcherAdapter();
    }
    return FetcherAdapter.instance;
  }
  
  /**
   * Format error message consistently
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  
  /**
   * Fetches transaction details by hash
   */
  public async fetchTxDetails(txHash: string, network: Network): Promise<any> {
    if (!this.fetcherService) {
      logger.error(`[FetcherAdapter] FetcherService is not available`);
      return null;
    }
    
    try {
      return await this.fetcherService.fetchTxDetails(txHash, network);
    } catch (error) {
      logger.error(`[FetcherAdapter] Error fetching transaction details: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Fetches transactions by block height
   */
  public async fetchTxsByHeight(height: string | number, network: Network): Promise<any[]> {
    if (!this.fetcherService) {
      logger.error(`[FetcherAdapter] FetcherService is not available`);
      return [];
    }
    
    try {
      return await this.fetcherService.fetchTxsByHeight(height, network);
    } catch (error) {
      logger.error(`[FetcherAdapter] Error fetching transactions by height: ${this.formatError(error)}`);
      return [];
    }
  }
  
  /**
   * Fetches block by height
   */
  public async fetchBlockByHeight(height: string | number, network: Network): Promise<any> {
    if (!this.fetcherService) {
      logger.error(`[FetcherAdapter] FetcherService is not available`);
      return null;
    }
    
    try {
      return await this.fetcherService.fetchBlockByHeight(height, network);
    } catch (error) {
      logger.error(`[FetcherAdapter] Error fetching block by height: ${this.formatError(error)}`);
      return null;
    }
  }
} 