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
}