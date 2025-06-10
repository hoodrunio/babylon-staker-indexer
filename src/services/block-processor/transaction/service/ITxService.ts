/**
 * Transaction Service Interface
 * Defines business logic operations for transactions
 */

import { BaseTx, PaginatedTxsResponse } from '../../types/common';
import { Network } from '../../../../types/finality';

export interface ITxService {
  /**
   * Gets transaction by hash
   * If useRawFormat is true, returns raw transaction data from blockchain
   */
  getTxByHash(txHash: string, network: Network, useRawFormat?: boolean): Promise<BaseTx | any | null>;
  
  /**
   * Gets transactions by height
   * If useRawFormat is true, returns raw transaction data from blockchain
   */
  getTxsByHeight(height: string | number, network: Network, useRawFormat?: boolean): Promise<BaseTx[] | any[]>;
  
  /**
   * Gets total transaction count
   */
  getTxCount(network: Network): Promise<number>;
  
  /**
   * Gets latest transactions with pagination
   * @param network Network to query
   * @param page Page number (optional)
   * @param limit Results per page (optional)
   * @param cursor Optional cursor for optimized pagination
   * @returns Paginated transaction response
   */
  getLatestTransactions(
    network: Network,
    page?: number,
    limit?: number,
    cursor?: string | null
  ): Promise<PaginatedTxsResponse>;
  
  /**
   * Migrates existing transactions to add firstMessageType field
   */
  migrateExistingTransactions(network: Network): Promise<void>;
  
  /**
   * Saves transaction
   */
  saveTx(tx: BaseTx, network: Network): Promise<void>;
} 