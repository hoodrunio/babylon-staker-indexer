/**
 * Block Fetcher Adapter Interface
 * Abstracts blockchain block data fetching operations
 */

import { Network } from '../../../../types/finality';

export interface IBlockFetcherAdapter {
  /**
   * Fetches block by height
   */
  fetchBlockByHeight(height: string | number, network: Network): Promise<any>;
  
  /**
   * Fetches block by hash
   */
  fetchBlockByHash(blockHash: string, network: Network): Promise<any>;
  
  /**
   * Fetches latest block
   */
  fetchLatestBlock(network: Network): Promise<any>;

  /**
   * Checks if a network is configured
   */
  isNetworkConfigured(network: Network): boolean;
} 