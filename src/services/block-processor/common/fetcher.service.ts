/**
 * Fetcher Service
 * Service that fetches transaction details from blockchain
 */

import { IFetcherService } from '../types/interfaces';
import { BabylonClient } from '../../../clients/BabylonClient';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { handleFutureBlockError } from '../../../utils/futureBlockHelper';
import { FutureBlockError } from '../../../types/errors';

/**
 * FetcherService is used to fetch complete transaction details from the blockchain
 * for transactions that have limited information stored in the database.
 * 
 * This service returns raw transaction details when requested via API.
 */
export class FetcherService implements IFetcherService {
  private static instance: FetcherService | null = null;
  private babylonClient: BabylonClient;
  
  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    try {
      this.babylonClient = BabylonClient.getInstance();
      const network = this.babylonClient.getNetwork();
      logger.info(`[FetcherService] ${network} client initialized successfully`);
    } catch (error) {
      logger.error('[FetcherService] Failed to initialize BabylonClient:', error);
      throw new Error('[FetcherService] Failed to initialize BabylonClient. Please check your NETWORK environment variable.');
    }
  }

  /**
   * Singleton instance getter
   */
  public static getInstance(): FetcherService {
    if (!FetcherService.instance) {
      FetcherService.instance = new FetcherService();
    }
    return FetcherService.instance;
  }

  /**
   * Fetches transaction details from blockchain
   * @param txHash Transaction hash
   * @param network Network type
   * @returns Transaction details
   */
  public async fetchTxDetails(txHash: string, _network?: Network): Promise<any> {
    const actualNetwork = this.babylonClient.getNetwork();
    try {
      //logger.debug(`[FetcherService] Fetching transaction details for ${txHash} on ${actualNetwork}`);
      
      const txDetails = await this.babylonClient.getTransaction(txHash);
      if (!txDetails) {
        logger.warn(`[FetcherService] Transaction ${txHash} not found on ${actualNetwork}`);
        return null;
      }
      
      //logger.debug(`[FetcherService] Successfully fetched transaction details for ${txHash} on ${actualNetwork}`);
      return txDetails;
    } catch (error) {
      logger.error(`[FetcherService] Error fetching transaction details for ${txHash} on ${actualNetwork}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to fetch transaction details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Returns supported networks
   * @returns List of supported networks
   */
  public getSupportedNetworks(): Network[] {
    return [this.babylonClient.getNetwork()];
  }

  /**
   * Fetches transactions by block height
   * @param height Block height
   * @param network Network type
   * @returns Array of transactions
   */
  public async fetchTxsByHeight(height: number | string, _network?: Network): Promise<any[]> {
    const actualNetwork = this.babylonClient.getNetwork();
    try {
      logger.debug(`[FetcherService] Fetching transactions for height ${height} on ${actualNetwork}`);
      
      // Use the getTxSearch method from BlockClient through BabylonClient
      const txSearchResult = await this.babylonClient.getTxSearch(Number(height));
      
      if (!txSearchResult || !txSearchResult.result || !txSearchResult.result.txs) {
        logger.warn(`[FetcherService] No transactions found for height ${height} on ${actualNetwork}`);
        return [];
      }
      
      //logger.debug(`[FetcherService] Successfully fetched ${txSearchResult.result.txs.length} transactions for height ${height} on ${actualNetwork}`);
      return txSearchResult.result.txs;
    } catch (error) {
      logger.error(`[FetcherService] Error fetching transactions for height ${height} on ${actualNetwork}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to fetch transactions for height ${height}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetches block by height
   * @param height Block height
   * @param network Network type
   * @returns Block details
   */
  public async fetchBlockByHeight(height: number | string, _network?: Network): Promise<any> {
    const actualNetwork = this.babylonClient.getNetwork();
    try {
      //logger.debug(`[FetcherService] Fetching block at height ${height} on ${actualNetwork}`);
      
      const blockData = await this.babylonClient.getBlockByHeight(Number(height));
      if (!blockData) {
        logger.warn(`[FetcherService] Block at height ${height} not found on ${actualNetwork}`);
        return null;
      }
      
      //logger.debug(`[FetcherService] Successfully fetched block at height ${height} on ${actualNetwork}`);
      return blockData;
    } catch (error) {
      // Check if this is a future block error
      if (error instanceof Error && 
         (error.name === 'HeightNotAvailableError' || 
          error.message.includes('SPECIAL_ERROR_HEIGHT_NOT_AVAILABLE') || 
          error.message.includes('SPECIAL_ERROR_FUTURE_HEIGHT'))) {
        
        try {
          // Try to enhance error with time estimates
          const enhancedError = await handleFutureBlockError(error, actualNetwork);
          
          // If successfully converted to FutureBlockError, throw it
          if (enhancedError instanceof FutureBlockError) {
            logger.info(`[FetcherService] Future block detected at height ${height}: ${enhancedError.message}`);
            throw enhancedError;
          }
          
          // Otherwise, throw a more descriptive error
          logger.warn(`[FetcherService] Block at height ${height} is not available yet (future block)`);
          throw new Error(`Block at height ${height} is not available yet (future block)`);
        } catch (enrichError) {
          // If enhancing the error fails, log and continue with standard error
          logger.warn(`[FetcherService] Failed to enhance future block error: ${enrichError instanceof Error ? enrichError.message : String(enrichError)}`);
        }
      }
      
      logger.error(`[FetcherService] Error fetching block at height ${height} on ${actualNetwork}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to fetch block at height ${height}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetches block by hash
   * Note: Currently, BabylonClient does not have a direct method to fetch blocks by hash.
   * This method is a placeholder and will return null until the functionality is implemented.
   * @param blockHash Block hash
   * @param network Network type
   * @returns Block details or null
   */
  public async fetchBlockByHash(blockHash: string, _network?: Network): Promise<any> {
    const actualNetwork = this.babylonClient.getNetwork();
    try {
      //logger.debug(`[FetcherService] Fetching block with hash ${blockHash} on ${actualNetwork}`);
      
      const blockData = await this.babylonClient.getBlockByHash(blockHash);
      if (!blockData) {
        logger.warn(`[FetcherService] Block with hash ${blockHash} not found on ${actualNetwork}`);
        return null;
      }
      
      //logger.debug(`[FetcherService] Successfully fetched block with hash ${blockHash} on ${actualNetwork}`);
      return blockData;
     
    } catch (error) {
      logger.error(`[FetcherService] Error fetching block with hash ${blockHash} on ${actualNetwork}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to fetch block with hash ${blockHash}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetches latest block
   * @param network Network type
   * @returns Latest block details
   */
  public async fetchLatestBlock(_network?: Network): Promise<any> {
    const actualNetwork = this.babylonClient.getNetwork();
    try {
      //logger.debug(`[FetcherService] Fetching latest block on ${actualNetwork}`);
      
      const latestBlock = await this.babylonClient.getLatestBlock();
      if (!latestBlock) {
        logger.warn(`[FetcherService] Unable to fetch latest block on ${actualNetwork}`);
        return null;
      }
      
      //logger.debug(`[FetcherService] Successfully fetched latest block on ${actualNetwork} at height ${latestBlock.block.header.height}`);
      return latestBlock;
    } catch (error) {
      logger.error(`[FetcherService] Error fetching latest block on ${actualNetwork}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to fetch latest block: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}