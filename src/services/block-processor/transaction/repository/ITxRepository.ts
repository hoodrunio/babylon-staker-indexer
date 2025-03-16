/**
 * Transaction Repository Interface
 * Defines database operations for transactions
 */

import { BaseTx } from '../../types/common';
import { Network } from '../../../../types/finality';
import { ITransaction } from '../../../../database/models/blockchain/Transaction';

export interface ITxRepository {
  /**
   * Saves transaction to database
   */
  saveTx(tx: BaseTx, network: Network): Promise<void>;
  
  /**
   * Finds transaction by hash
   */
  findTxByHash(txHash: string, network: Network): Promise<ITransaction | null>;
  
  /**
   * Finds transactions by height
   */
  findTxsByHeight(height: string, network: Network): Promise<ITransaction[]>;
  
  /**
   * Gets total transaction count
   */
  getTxCount(network: Network): Promise<number>;
  
  /**
   * Gets paginated transactions
   */
  getPaginatedTransactions(
    network: Network,
    page: number,
    limit: number,
    sortOptions?: Record<string, any>
  ): Promise<{
    transactions: ITransaction[],
    total: number,
    pages: number
  }>;
  
  /**
   * Gets transactions with range-based pagination
   * This is an alternative pagination method that uses a reference point instead of skip/limit
   */
  getTransactionsWithRangePagination(
    network: Network,
    limit: number,
    lastItem: any
  ): Promise<{
    transactions: ITransaction[],
    total: number,
    pages: number
  }>;
  
  /**
   * Updates existing transactions with firstMessageType field
   */
  updateTransactionsWithFirstMessageType(
    network: Network,
    batchSize: number
  ): Promise<number>;
} 