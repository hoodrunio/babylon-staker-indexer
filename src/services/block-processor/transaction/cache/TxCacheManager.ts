/**
 * Transaction Cache Manager
 * Handles caching for transaction data
 */

import { PaginatedTxsResponse } from '../../types/common';
import { logger } from '../../../../utils/logger';

export class TxCacheManager {
  private static instance: TxCacheManager | null = null;
  
  // Cache for transaction queries
  private transactionCache: Map<string, { data: PaginatedTxsResponse, timestamp: number }> = new Map();
  private readonly CACHE_TTL = 10 * 1000; // 10 seconds cache duration
  
  // Cache for pagination markers
  private paginationCache: Map<string, { lastItem: any, timestamp: number }> = new Map();
  private readonly PAGINATION_CACHE_TTL = 30 * 1000; // 60 seconds pagination cache duration
  
  private constructor() {
    // Private constructor to enforce singleton pattern
  }
  
  /**
   * Singleton instance
   */
  public static getInstance(): TxCacheManager {
    if (!TxCacheManager.instance) {
      TxCacheManager.instance = new TxCacheManager();
    }
    return TxCacheManager.instance;
  }
  
  /**
   * Gets cached transaction data if available
   * @param cacheKey Cache key
   * @returns Cached data or null if not found or expired
   */
  public getCachedTransactions(cacheKey: string): PaginatedTxsResponse | null {
    const cachedData = this.transactionCache.get(cacheKey);
    const now = Date.now();
    
    if (cachedData && (now - cachedData.timestamp) < this.CACHE_TTL) {
      logger.debug(`[TxCacheManager] Returning cached transactions for key: ${cacheKey}`);
      return cachedData.data;
    }
    
    return null;
  }
  
  /**
   * Caches transaction data
   * @param cacheKey Cache key
   * @param data Data to cache
   */
  public cacheTransactions(cacheKey: string, data: PaginatedTxsResponse): void {
    this.transactionCache.set(cacheKey, { 
      data, 
      timestamp: Date.now() 
    });
    logger.debug(`[TxCacheManager] Cached transactions for key: ${cacheKey}`);
  }
  
  /**
   * Gets cached pagination marker if available
   * @param cacheKey Cache key
   * @returns Cached pagination marker or null if not found or expired
   */
  public getCachedPaginationMarker(cacheKey: string): any | null {
    const cachedPagination = this.paginationCache.get(cacheKey);
    const now = Date.now();
    
    if (cachedPagination && (now - cachedPagination.timestamp) < this.PAGINATION_CACHE_TTL) {
      logger.debug(`[TxCacheManager] Returning cached pagination marker for key: ${cacheKey}`);
      return cachedPagination.lastItem;
    }
    
    return null;
  }
  
  /**
   * Caches pagination marker
   * @param cacheKey Cache key
   * @param lastItem Last item in the page
   */
  public cachePaginationMarker(cacheKey: string, lastItem: any): void {
    this.paginationCache.set(cacheKey, { 
      lastItem, 
      timestamp: Date.now() 
    });
    logger.debug(`[TxCacheManager] Cached pagination marker for key: ${cacheKey}`);
  }
  
  /**
   * Clears all caches
   */
  public clearAllCaches(): void {
    this.transactionCache.clear();
    this.paginationCache.clear();
    logger.info(`[TxCacheManager] All caches cleared`);
  }
  
  /**
   * Clears transaction cache for a specific key
   * @param cacheKey Cache key
   */
  public clearTransactionCache(cacheKey: string): void {
    this.transactionCache.delete(cacheKey);
    logger.debug(`[TxCacheManager] Transaction cache cleared for key: ${cacheKey}`);
  }
  
  /**
   * Clears pagination cache for a specific key
   * @param cacheKey Cache key
   */
  public clearPaginationCache(cacheKey: string): void {
    this.paginationCache.delete(cacheKey);
    logger.debug(`[TxCacheManager] Pagination cache cleared for key: ${cacheKey}`);
  }
} 