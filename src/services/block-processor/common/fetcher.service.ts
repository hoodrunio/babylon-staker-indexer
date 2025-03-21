/**
 * Fetcher Service
 * Service that fetches transaction details from blockchain
 */

import { IFetcherService } from '../types/interfaces';
import { BabylonClient } from '../../../clients/BabylonClient';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';

/**
 * FetcherService is used to fetch complete transaction details from the blockchain
 * for transactions that have limited information stored in the database.
 * 
 * This service returns raw transaction details when requested via API.
 */
export class FetcherService implements IFetcherService {
  private static instance: FetcherService | null = null;
  private babylonClients: Map<Network, BabylonClient> = new Map();
  
  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    try {
      this.babylonClients.set(Network.MAINNET, BabylonClient.getInstance(Network.MAINNET));
      logger.info('[FetcherService] Mainnet client initialized successfully');
    } catch (error) {
      logger.warn('[FetcherService] Mainnet is not configured, skipping');
    }

    try {
      this.babylonClients.set(Network.TESTNET, BabylonClient.getInstance(Network.TESTNET));
      logger.info('[FetcherService] Testnet client initialized successfully');
    } catch (error) {
      logger.warn('[FetcherService] Testnet is not configured, skipping');
    }

    if (this.babylonClients.size === 0) {
      throw new Error('[FetcherService] No network configurations found. Please configure at least one network.');
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
  public async fetchTxDetails(txHash: string, network: Network): Promise<any> {
    try {
      logger.debug(`[FetcherService] Fetching transaction details for ${txHash} on ${network}`);
      
      const client = this.babylonClients.get(network);
      if (!client) {
        throw new Error(`[FetcherService] No client configured for network ${network}`);
      }
      
      const txDetails = await client.getTransaction(txHash);
      if (!txDetails) {
        logger.warn(`[FetcherService] Transaction ${txHash} not found on ${network}`);
        return null;
      }
      
      logger.debug(`[FetcherService] Successfully fetched transaction details for ${txHash} on ${network}`);
      return txDetails;
    } catch (error) {
      logger.error(`[FetcherService] Error fetching transaction details for ${txHash} on ${network}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to fetch transaction details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Returns supported networks
   * @returns List of supported networks
   */
  public getSupportedNetworks(): Network[] {
    return Array.from(this.babylonClients.keys());
  }

  /**
   * Fetches transactions by block height
   * @param height Block height
   * @param network Network type
   * @returns Array of transactions
   */
  public async fetchTxsByHeight(height: number | string, network: Network): Promise<any[]> {
    try {
      logger.debug(`[FetcherService] Fetching transactions for height ${height} on ${network}`);
      
      const client = this.babylonClients.get(network);
      if (!client) {
        throw new Error(`[FetcherService] No client configured for network ${network}`);
      }
      
      // Use the getTxSearch method from BlockClient through BabylonClient
      const txSearchResult = await client.getTxSearch(Number(height));
      
      if (!txSearchResult || !txSearchResult.result || !txSearchResult.result.txs) {
        logger.warn(`[FetcherService] No transactions found for height ${height} on ${network}`);
        return [];
      }
      
      logger.debug(`[FetcherService] Successfully fetched ${txSearchResult.result.txs.length} transactions for height ${height} on ${network}`);
      return txSearchResult.result.txs;
    } catch (error) {
      logger.error(`[FetcherService] Error fetching transactions for height ${height} on ${network}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to fetch transactions for height ${height}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetches block by height
   * @param height Block height
   * @param network Network type
   * @returns Block details
   */
  public async fetchBlockByHeight(height: number | string, network: Network): Promise<any> {
    try {
      logger.debug(`[FetcherService] Fetching block at height ${height} on ${network}`);
      
      const client = this.babylonClients.get(network);
      if (!client) {
        throw new Error(`[FetcherService] No client configured for network ${network}`);
      }
      
      const blockData = await client.getBlockByHeight(Number(height));
      if (!blockData) {
        logger.warn(`[FetcherService] Block at height ${height} not found on ${network}`);
        return null;
      }
      
      logger.debug(`[FetcherService] Successfully fetched block at height ${height} on ${network}`);
      return blockData;
    } catch (error) {
      logger.error(`[FetcherService] Error fetching block at height ${height} on ${network}: ${error instanceof Error ? error.message : String(error)}`);
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
  public async fetchBlockByHash(blockHash: string, network: Network): Promise<any> {
    try {
      logger.debug(`[FetcherService] Fetching block with hash ${blockHash} on ${network}`);
      
      const client = this.babylonClients.get(network);
      if (!client) {
        throw new Error(`[FetcherService] No client configured for network ${network}`);
      }
      
      const blockData = await client.getBlockByHash(blockHash);
      if (!blockData) {
        logger.warn(`[FetcherService] Block with hash ${blockHash} not found on ${network}`);
        return null;
      }
      
      logger.debug(`[FetcherService] Successfully fetched block with hash ${blockHash} on ${network}`);
      return blockData;
     
    } catch (error) {
      logger.error(`[FetcherService] Error fetching block with hash ${blockHash} on ${network}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to fetch block with hash ${blockHash}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetches latest block
   * @param network Network type
   * @returns Latest block details
   */
  public async fetchLatestBlock(network: Network): Promise<any> {
    try {
      logger.debug(`[FetcherService] Fetching latest block on ${network}`);
      
      const client = this.babylonClients.get(network);
      if (!client) {
        throw new Error(`[FetcherService] No client configured for network ${network}`);
      }
      
      const blockData = await client.getLatestBlock();
      if (!blockData) {
        logger.warn(`[FetcherService] Latest block not found on ${network}`);
        return null;
      }
      
      logger.debug(`[FetcherService] Successfully fetched latest block on ${network}`);
      return blockData;
    } catch (error) {
      logger.error(`[FetcherService] Error fetching latest block on ${network}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to fetch latest block: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}