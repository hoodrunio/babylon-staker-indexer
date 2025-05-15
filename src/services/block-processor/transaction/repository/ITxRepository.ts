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
   * firstMessageType is the first message type extracted from the transaction content
   */
  saveTx(tx: BaseTx, network: Network, firstMessageType?: string): Promise<void>;
  
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
   * Gets paginated transactions using optimized cursor-based pagination
   */
  getPaginatedTransactions(
    network: Network,
    page: number,
    limit: number,
    sortOptions?: Record<string, any>,
    cursor?: string | null
  ): Promise<{
    transactions: ITransaction[],
    total: number,
    pages: number,
    nextCursor: string | null
  }>;
  
  /**
   * Gets latest transactions with optimized range-based pagination
   * This function should be used for getting the most recent transactions
   */
  getLatestTransactions(
    network: Network,
    limit: number
  ): Promise<{
    transactions: ITransaction[],
    total: number,
    pages: number
  }>;
  
  /**
   * Find transactions using a custom query
   * This is used for bidirectional cursor pagination
   * @param query MongoDB query object
   * @param sortOptions Sort options
   * @param limit Maximum number of documents to return
   * @returns Array of transaction documents
   */
  findTransactionsWithQuery(
    query: Record<string, any>,
    sortOptions: Record<string, number>,
    limit: number
  ): Promise<ITransaction[]>;
  
  /**
   * Updates existing transactions with firstMessageType field
   */
  updateTransactionsWithFirstMessageType(
    network: Network,
    batchSize: number
  ): Promise<number>;

  /**
   * Returns the number of transactions created within a certain period, of a certain type and with full content
   * (non-lite-mode)
   */
  countRecentFullTxsByType(
    messageType: string,
    network: Network,
    hoursAgo: number
  ): Promise<number>;
}