/**
 * Transaction Service
 * Implements business logic for transactions
 */

import { BaseTx, PaginatedTxsResponse, SimpleTx } from '../../types/common';
import { Network } from '../../../../types/finality';
import { ITxService } from './ITxService';
import { ITxRepository } from '../repository/ITxRepository';
import { TxRepository } from '../repository/TxRepository';
import { IFetcherAdapter } from './IFetcherAdapter';
import { FetcherAdapter } from './FetcherAdapter';
import { TxMapper } from '../mapper/TxMapper';
import { TxCacheManager } from '../cache/TxCacheManager';
import { logger } from '../../../../utils/logger';
import { ITransaction } from '../../../../database/models/blockchain/Transaction';
import { DEFAULT_LITE_STORAGE_CONFIG, LITE_STORAGE_TX_TYPES, LiteStorageConfig } from '../../types/common';

export class TxService implements ITxService {
  private static instance: TxService | null = null;
  private txRepository: ITxRepository;
  private fetcherAdapter: IFetcherAdapter;
  private cacheManager: TxCacheManager;
  private liteStorageConfig: LiteStorageConfig;
  
  private constructor(
    txRepository: ITxRepository,
    fetcherAdapter: IFetcherAdapter,
    cacheManager: TxCacheManager
  ) {
    this.txRepository = txRepository;
    this.fetcherAdapter = fetcherAdapter;
    this.cacheManager = cacheManager;
    this.liteStorageConfig = DEFAULT_LITE_STORAGE_CONFIG;
  }
  
  /**
   * Singleton instance
   */
  public static getInstance(): TxService {
    if (!TxService.instance) {
      const txRepository = TxRepository.getInstance();
      const fetcherAdapter = FetcherAdapter.getInstance();
      const cacheManager = TxCacheManager.getInstance();
      
      TxService.instance = new TxService(
        txRepository,
        fetcherAdapter,
        cacheManager
      );
    }
    return TxService.instance;
  }
  
  /**
   * Format error message consistently
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  
  /**
   * Gets transaction by hash
   * If useRawFormat is true, returns raw transaction data from blockchain
   */
  public async getTxByHash(txHash: string, network: Network, useRawFormat: boolean = false): Promise<BaseTx | any | null> {
    try {
      // If raw format is requested, always fetch from blockchain
      if (useRawFormat) {
        return await this.fetcherAdapter.fetchTxDetails(txHash, network);
      }
      
      // For standard format, first try to get from database
      const tx = await this.txRepository.findTxByHash(txHash, network);
      
      if (tx) {
        // If transaction is stored in lite mode and has no metadata,
        // we need to fetch the full version from the blockchain
        if (tx.isLite && (!tx.meta || tx.meta.length === 0)) {
          logger.info(`[TxService] Transaction ${txHash} is stored in lite mode, fetching full data from blockchain`);
          return await this.fetchAndPopulateLiteTx(tx, network);
        }
        return TxMapper.mapToBaseTx(tx);
      }
      
      // If not found in database, try to fetch from blockchain
      return await this.fetchAndSaveTxByHash(txHash, network);
    } catch (error) {
      logger.error(`[TxService] Error getting transaction by hash: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Gets transactions by height
   * If useRawFormat is true, returns raw transaction data from blockchain
   */
  public async getTxsByHeight(height: string | number, network: Network, useRawFormat: boolean = false): Promise<BaseTx[] | any[]> {
    try {
      // If raw format is requested, always fetch from blockchain
      if (useRawFormat) {
        return await this.fetcherAdapter.fetchTxsByHeight(height, network);
      }
      
      // For standard format, first try to get from database
      const heightStr = height.toString();
      const txs = await this.txRepository.findTxsByHeight(heightStr, network);
      
      // If transactions found in database, return them
      if (txs.length > 0) {
        return txs.map(tx => TxMapper.mapToBlockTx(tx));
      }
      
      // If no transactions found in database, try to fetch from blockchain
      return await this.fetchAndSaveTxsByHeight(height, network);
    } catch (error) {
      logger.error(`[TxService] Error getting transactions by height: ${this.formatError(error)}`);
      return [];
    }
  }
  
  /**
   * Gets total transaction count
   */
  public async getTxCount(network: Network): Promise<number> {
    try {
      return await this.txRepository.getTxCount(network);
    } catch (error) {
      logger.error(`[TxService] Error getting transaction count: ${this.formatError(error)}`);
      return 0;
    }
  }
  
  /**
   * Gets latest transactions with pagination
   */
  public async getLatestTransactions(
    network: Network,
    page: number = 1,
    limit: number = 50
  ): Promise<PaginatedTxsResponse> {
    try {
      // Ensure page and limit are valid
      page = Math.max(1, page); // Minimum page is 1
      limit = Math.min(100, Math.max(1, limit)); // limit between 1 and 100
      
      // Cache key
      const cacheKey = `${network}-${page}-${limit}`;
      
      // Check cache
      const cachedData = this.cacheManager.getCachedTransactions(cacheKey);
      if (cachedData) {
        return cachedData;
      }
      
      // Start time for performance measurement
      const startTime = Date.now();
      
      // If page is 1, use standard pagination
      if (page === 1) {
        const { transactions, total, pages } = await this.txRepository.getPaginatedTransactions(
          network,
          page,
          limit
        );
        
        // Map to SimpleTx
        const simpleTxs: SimpleTx[] = transactions.map((tx: ITransaction) => TxMapper.mapToSimpleTx(tx));
        
        // Create response
        const response: PaginatedTxsResponse = {
          transactions: simpleTxs,
          pagination: {
            total,
            page,
            limit,
            pages
          }
        };
        
        // Cache the last item for range-based pagination
        if (transactions.length > 0) {
          const lastItem = transactions[transactions.length - 1];
          this.cacheManager.cachePaginationMarker(`${network}-page1-${limit}`, lastItem);
        }
        
        // Cache the response
        this.cacheManager.cacheTransactions(cacheKey, response);
        
        // Log performance
        const processingTime = Date.now() - startTime;
        logger.debug(`[TxService] getLatestTransactions completed in ${processingTime}ms`);
        
        return response;
      } else {
        // For subsequent pages, try to use range-based pagination
        // Get the last item from the previous page
        const previousPageKey = `${network}-page${page-1}-${limit}`;
        const lastItem = this.cacheManager.getCachedPaginationMarker(previousPageKey);
        
        if (lastItem) {
          // Use range-based pagination
          const { transactions, total, pages } = await this.txRepository.getTransactionsWithRangePagination(
            network,
            limit,
            lastItem
          );
          
          // Map to SimpleTx
          const simpleTxs: SimpleTx[] = transactions.map((tx: ITransaction) => TxMapper.mapToSimpleTx(tx));
          
          // Create response
          const response: PaginatedTxsResponse = {
            transactions: simpleTxs,
            pagination: {
              total,
              page,
              limit,
              pages
            }
          };
          
          // Cache the last item for range-based pagination
          if (transactions.length > 0) {
            const newLastItem = transactions[transactions.length - 1];
            this.cacheManager.cachePaginationMarker(`${network}-page${page}-${limit}`, newLastItem);
          }
          
          // Cache the response
          this.cacheManager.cacheTransactions(cacheKey, response);
          
          // Log performance
          const processingTime = Date.now() - startTime;
          logger.debug(`[TxService] getLatestTransactions with range pagination completed in ${processingTime}ms`);
          
          return response;
        } else {
          // Fall back to standard pagination if no last item found
          logger.warn(`[TxService] No pagination marker found for ${previousPageKey}, falling back to standard pagination`);
          
          const { transactions, total, pages } = await this.txRepository.getPaginatedTransactions(
            network,
            page,
            limit
          );
          
          // Map to SimpleTx
          const simpleTxs: SimpleTx[] = transactions.map((tx: ITransaction) => TxMapper.mapToSimpleTx(tx));
          
          // Create response
          const response: PaginatedTxsResponse = {
            transactions: simpleTxs,
            pagination: {
              total,
              page,
              limit,
              pages
            }
          };
          
          // Cache the response
          this.cacheManager.cacheTransactions(cacheKey, response);
          
          // Log performance
          const processingTime = Date.now() - startTime;
          logger.debug(`[TxService] getLatestTransactions with standard pagination completed in ${processingTime}ms`);
          
          return response;
        }
      }
    } catch (error) {
      logger.error(`[TxService] Error getting latest transactions: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Migrates existing transactions to add firstMessageType field
   */
  public async migrateExistingTransactions(network: Network): Promise<void> {
    try {
      logger.info(`[TxService] Starting migration of existing transactions for ${network} to add firstMessageType field`);
      
      const processed = await this.txRepository.updateTransactionsWithFirstMessageType(network, 100);
      
      logger.info(`[TxService] Migration completed for ${network}. Migrated ${processed} transactions.`);
    } catch (error) {
      logger.error(`[TxService] Error migrating transactions: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Saves a transaction
   * Decides whether to store it in full or lite mode based on transaction type
   */
  public async saveTx(tx: BaseTx, network: Network): Promise<void> {
    try {
      // Extract firstMessageType from meta data
      const firstMessageType = TxMapper.extractFirstMessageType(tx);
      
      // Determine if this tx type should be stored in lite mode
      const shouldStoreLite = this.shouldStoreTxInLiteMode(tx);

      // Clone the transaction to avoid modifying the original
      const txToSave: BaseTx = { ...tx };
      
      // Evaluate lite mode only for specific tx types
      // All other txs are always stored with full content
      if (shouldStoreLite) {
        const canStoreFullContent = await this.canStoreFullContent(txToSave, network);
        
        if (!canStoreFullContent) {
          // If we shouldn't store full content, remove meta data
          delete txToSave.meta;
        }
      }
      try {
        // Save to database with isLite flag if needed
        await this.txRepository.saveTx({
          ...txToSave,
          isLite: shouldStoreLite && !txToSave.meta
        }, network, firstMessageType);
      } catch (dbError) {
        // Handle database errors
        throw dbError;
      }
    } catch (error) {
      logger.error(`[TxService] Error saving transaction: ${this.formatError(error)}`);
      throw error;
    }
  }
  
  /**
   * Determines if a transaction should be stored in lite mode based on its type
   */
  private shouldStoreTxInLiteMode(tx: BaseTx): boolean {
    if (!tx.meta || tx.meta.length === 0) return false;
    
    // Decide based on the first message type
    const messageType = tx.meta[0]?.typeUrl;
    
    // Apply lite mode for specific tx types
    // This list is directly defined in the code and does not change (LITE_STORAGE_TX_TYPES)
    // "/babylon.finality.v1.MsgAddFinalitySig" and "/ibc.core.client.v1.MsgUpdateClient"
    return LITE_STORAGE_TX_TYPES.includes(messageType);
  }
  
  /**
   * Checks if we should store the full content for a transaction
   * This is based on how many full versions we already have and retention policy
   */
  private async canStoreFullContent(tx: BaseTx, network: Network): Promise<boolean> {
    if (!tx.meta || tx.meta.length === 0) return false;
    
    try {
      const messageType = tx.meta[0]?.typeUrl;
      
      // If it's not a filtered type, always store full content
      if (!LITE_STORAGE_TX_TYPES.includes(messageType)) {
        return true;
      }
      
      // Count the full records within a specific period
      const recentCount = await this.txRepository.countRecentFullTxsByType(
        messageType,
        network,
        this.liteStorageConfig.fullContentRetentionHours
      );
      
      // If it's less than the maximum number, make a full record
      return recentCount < this.liteStorageConfig.maxStoredFullInstances;
    } catch (error) {
      logger.error(`[TxService] Error checking if can store full content: ${this.formatError(error)}`);
      return false;
    }
  }
  
  /**
   * Fetches full transaction data for a lite transaction and returns it in the expected format
   */
  private async fetchAndPopulateLiteTx(liteTx: ITransaction, network: Network): Promise<BaseTx | null> {
    try {
      // Pull full data from the blockchain
      const rawTx = await this.fetcherAdapter.fetchTxDetails(liteTx.txHash, network);
      if (!rawTx) {
        return TxMapper.mapToBaseTx(liteTx); // If raw tx is not found, return the lite version we have
      }
      
      // Convert raw data to BaseTx format
      const baseTx = TxMapper.convertRawTxToBaseTx(rawTx);
      
      // We do not save and update the full data in the database, we only return it for temporary use
      // This way we do not fill the database with unnecessary data
      return baseTx;
    } catch (error) {
      logger.error(`[TxService] Error fetching full data for lite tx: ${this.formatError(error)}`);
      // Return the current lite data in case of error
      return TxMapper.mapToBaseTx(liteTx);
    }
  }
  
  /**
   * Updates lite storage configuration
   */
  public updateLiteStorageConfig(config: Partial<LiteStorageConfig>): void {
    this.liteStorageConfig = {
      ...this.liteStorageConfig,
      ...config
    };
    logger.info(`[TxService] Updated lite storage config: ${JSON.stringify(this.liteStorageConfig)}`);
  }
  
  /**
   * Gets current lite storage configuration
   */
  public getLiteStorageConfig(): LiteStorageConfig {
    return { ...this.liteStorageConfig };
  }
  
  /**
   * Fetch transaction by hash from blockchain, convert to BaseTx, save to database, and return
   */
  private async fetchAndSaveTxByHash(txHash: string, network: Network): Promise<BaseTx | null> {
    logger.info(`[TxService] Transaction ${txHash} not found in storage, fetching from blockchain`);
    
    try {
      const txDetails = await this.fetcherAdapter.fetchTxDetails(txHash, network);
      
      if (!txDetails) {
        return null;
      }
      
      const baseTx = TxMapper.convertRawTxToBaseTx(txDetails);
      await this.saveTx(baseTx, network);
      return baseTx;
    } catch (error) {
      logger.error(`[TxService] Error fetching transaction by hash: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Fetch transactions by height from blockchain, convert to BaseTx, save to database, and return
   */
  private async fetchAndSaveTxsByHeight(height: string | number, network: Network): Promise<BaseTx[]> {
    logger.info(`[TxService] No transactions found for height ${height} in storage, fetching from blockchain`);
    
    try {
      const rawTxs = await this.fetcherAdapter.fetchTxsByHeight(height, network);
      
      if (!rawTxs || rawTxs.length === 0) {
        logger.info(`[TxService] No transactions found for height ${height} from blockchain`);
        return [];
      }
      
      logger.info(`[TxService] Found ${rawTxs.length} transactions for height ${height} from blockchain`);
      
      // Check if the response is in tx_search format (has tx_result property)
      if (Array.isArray(rawTxs) && rawTxs[0]?.hash && rawTxs[0]?.tx_result) {
        logger.debug(`[TxService] Converting tx_search format transactions`);
        
        // Get block time for these transactions
        const blockData = await this.fetcherAdapter.fetchBlockByHeight(height, network);
        const blockTime = blockData?.result?.block?.header?.time || new Date().toISOString();
        
        // Convert and save each transaction
        const baseTxs: BaseTx[] = [];
        
        for (const rawTx of rawTxs) {
          try {
            const baseTx = await TxMapper.convertTxSearchResultToBaseTx(rawTx, blockTime);
            await this.saveTx(baseTx, network);
            baseTxs.push(baseTx);
          } catch (error) {
            logger.error(`[TxService] Error processing tx_search result: ${this.formatError(error)}`);
          }
        }
        
        return baseTxs;
      } else {
        logger.debug(`[TxService] Converting standard format transactions`);
        
        // Convert and save each transaction
        const baseTxs: BaseTx[] = [];
        
        for (const rawTx of rawTxs) {
          try {
            const baseTx = TxMapper.convertRawTxToBaseTx(rawTx);
            await this.saveTx(baseTx, network);
            baseTxs.push(baseTx);
          } catch (error) {
            logger.error(`[TxService] Error processing raw transaction: ${this.formatError(error)}`);
          }
        }
        
        return baseTxs;
      }
    } catch (error) {
      logger.error(`[TxService] Error fetching transactions by height: ${this.formatError(error)}`);
      return [];
    }
  }
}