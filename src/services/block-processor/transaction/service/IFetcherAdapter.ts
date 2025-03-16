/**
 * Fetcher Adapter Interface
 * Abstracts blockchain data fetching operations
 */

import { Network } from '../../../../types/finality';

export interface IFetcherAdapter {
  /**
   * Fetches transaction details by hash
   */
  fetchTxDetails(txHash: string, network: Network): Promise<any>;
  
  /**
   * Fetches transactions by block height
   */
  fetchTxsByHeight(height: string | number, network: Network): Promise<any[]>;
  
  /**
   * Fetches block by height
   */
  fetchBlockByHeight(height: string | number, network: Network): Promise<any>;
} 