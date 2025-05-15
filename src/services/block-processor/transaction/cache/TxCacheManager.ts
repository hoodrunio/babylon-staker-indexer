/**
 * Transaction Cache Manager
 * Handles caching for transaction data with a multi-tier caching strategy
 */

import { PaginatedTxsResponse } from '../../types/common';
import { logger } from '../../../../utils/logger';
import { Network } from '../../../../types/finality';

// Cache item interface
interface CacheItem<T> {
  data: T;
  timestamp: number;
  refreshing?: boolean;
}

// Interface for cache stats
interface CacheStats {
  hits: number;
  misses: number;
  refreshes: number;
}

export class TxCacheManager {
  private static instance: TxCacheManager | null = null;
  
  // Hot cache for frequently accessed, most recent transactions
  private hotCache: Map<string, CacheItem<PaginatedTxsResponse>> = new Map();
  private readonly HOT_CACHE_TTL = 5 * 1000; // 10 seconds
  
  // Warm cache for less frequently accessed data (older pages)
  private warmCache: Map<string, CacheItem<PaginatedTxsResponse>> = new Map();
  private readonly WARM_CACHE_TTL = 60 * 1000; // 1 minute
  
  // Background refresh markers to prevent duplicate refreshes
  private refreshInProgress: Set<string> = new Set();
  
  // Cache for cursor pagination
  private cursorCache: Map<string, CacheItem<any>> = new Map();
  private readonly CURSOR_CACHE_TTL = 60 * 1000; // 1 minute
  
  // Cache for cursor history (to support two-way pagination)
  private cursorHistoryCache: Map<string, {prevCursor: string | null, nextCursor: string | null}> = new Map();
  private readonly CURSOR_HISTORY_TTL = 30 * 60 * 1000; // 30 minutes
  
  // Cache for latest known block heights per network
  private latestBlockCache: Map<Network, { height: number, timestamp: number }> = new Map();
  
  // Track cache statistics
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    refreshes: 0
  };
  
  private constructor() {
    // Private constructor to enforce singleton pattern
    this.startPeriodicCleanup();
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
   * @param isFirstPage Whether this is the first page (most frequently accessed)
   * @returns Cached data or null if not found or expired
   */
  public getCachedTransactions(cacheKey: string, isFirstPage: boolean = false): PaginatedTxsResponse | null {
    // First check hot cache (for first page or most recent requests)
    const hotItem = this.hotCache.get(cacheKey);
    const now = Date.now();
    
    if (hotItem && (now - hotItem.timestamp) < this.HOT_CACHE_TTL) {
      this.stats.hits++;
      logger.debug(`[TxCacheManager] Hot cache hit for key: ${cacheKey}`);
      return hotItem.data;
    }
    
    // Then check warm cache (for subsequent pages or less frequent data)
    const warmItem = this.warmCache.get(cacheKey);
    
    if (warmItem && (now - warmItem.timestamp) < this.WARM_CACHE_TTL) {
      // Move to hot cache if this is a first page request
      if (isFirstPage) {
        this.hotCache.set(cacheKey, warmItem);
        this.warmCache.delete(cacheKey);
      }
      this.stats.hits++;
      logger.debug(`[TxCacheManager] Warm cache hit for key: ${cacheKey}`);
      return warmItem.data;
    }
    
    this.stats.misses++;
    return null;
  }
  
  /**
   * Caches transaction data in appropriate tier
   * @param cacheKey Cache key
   * @param data Data to cache
   * @param isFirstPage Whether this is for the first page (determines which cache to use)
   */
  public cacheTransactions(cacheKey: string, data: PaginatedTxsResponse, isFirstPage: boolean = false): void {
    const cacheItem: CacheItem<PaginatedTxsResponse> = { 
      data, 
      timestamp: Date.now()
    };
    
    // First page or hot content goes to hot cache
    if (isFirstPage) {
      this.hotCache.set(cacheKey, cacheItem);
      logger.debug(`[TxCacheManager] Cached transactions in hot cache for key: ${cacheKey}`);
    } else {
      this.warmCache.set(cacheKey, cacheItem);
      logger.debug(`[TxCacheManager] Cached transactions in warm cache for key: ${cacheKey}`);
    }
  }
  
  /**
   * Gets cached cursor if available
   * @param cacheKey Cache key
   * @returns Cached cursor or null if not found or expired
   */
  public getCachedCursor(cacheKey: string): any | null {
    const cachedCursor = this.cursorCache.get(cacheKey);
    const now = Date.now();
    
    if (cachedCursor && (now - cachedCursor.timestamp) < this.CURSOR_CACHE_TTL) {
      logger.debug(`[TxCacheManager] Returning cached cursor for key: ${cacheKey}`);
      return cachedCursor.data;
    }
    
    return null;
  }
  
  /**
   * Caches cursor for pagination
   * @param cacheKey Cache key
   * @param cursor Cursor data
   */
  public cacheCursor(cacheKey: string, cursor: any): void {
    this.cursorCache.set(cacheKey, { 
      data: cursor, 
      timestamp: Date.now() 
    });
    logger.debug(`[TxCacheManager] Cached cursor for key: ${cacheKey}`);
  }
  
  /**
   * Store cursor history for bi-directional pagination
   * @param cursor Current cursor
   * @param prevCursor Previous cursor
   * @param nextCursor Next cursor 
   */
  public storeCursorHistory(cursor: string, prevCursor: string | null, nextCursor: string | null): void {
    this.cursorHistoryCache.set(cursor, {
      prevCursor,
      nextCursor
    });
    logger.debug(`[TxCacheManager] Stored cursor history for cursor: ${cursor}`);
  }
  
  /**
   * Get cursor links from history
   * @param cursor Current cursor
   * @returns Object containing previous and next cursors, or null if history not found
   */
  public getCursorHistory(cursor: string): { prevCursor: string | null, nextCursor: string | null } | null {
    const history = this.cursorHistoryCache.get(cursor);
    if (history) {
      logger.debug(`[TxCacheManager] Found cursor history for cursor: ${cursor}`);
      return history;
    }
    logger.debug(`[TxCacheManager] No cursor history found for cursor: ${cursor}`);
    return null;
  }
  
  /**
   * Update latest known block height for a network
   * @param network Network
   * @param height Block height
   */
  public updateLatestBlockHeight(network: Network, height: number): void {
    this.latestBlockCache.set(network, {
      height,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get latest known block height for a network
   * @param network Network
   */
  public getLatestBlockHeight(network: Network): number | null {
    const data = this.latestBlockCache.get(network);
    if (!data) return null;
    return data.height;
  }
  
  /**
   * Mark a cache key as being refreshed to prevent duplicate refresh operations
   * @param cacheKey Cache key
   * @returns True if successfully marked (no other refresh in progress)
   */
  public markRefreshInProgress(cacheKey: string): boolean {
    if (this.refreshInProgress.has(cacheKey)) {
      return false;
    }
    
    this.refreshInProgress.add(cacheKey);
    return true;
  }
  
  /**
   * Complete a refresh operation
   * @param cacheKey Cache key
   */
  public completeRefresh(cacheKey: string): void {
    this.refreshInProgress.delete(cacheKey);
    this.stats.refreshes++;
  }
  
  /**
   * Get cache stats
   */
  public getStats(): CacheStats {
    return { ...this.stats };
  }
  
  /**
   * Reset cache stats
   */
  public resetStats(): void {
    this.stats = { hits: 0, misses: 0, refreshes: 0 };
  }
  
  /**
   * Clears all caches
   */
  public clearAllCaches(): void {
    this.hotCache.clear();
    this.warmCache.clear();
    this.cursorCache.clear();
    this.refreshInProgress.clear();
    this.latestBlockCache.clear();
    logger.info(`[TxCacheManager] All caches cleared`);
  }
  
  /**
   * Clears transaction cache for a specific key
   * @param cacheKey Cache key
   */
  public clearTransactionCache(cacheKey: string): void {
    this.hotCache.delete(cacheKey);
    this.warmCache.delete(cacheKey);
    logger.debug(`[TxCacheManager] Transaction cache cleared for key: ${cacheKey}`);
  }
  
  /**
   * Clears cursor cache for a specific key
   * @param cacheKey Cache key
   */
  public clearCursorCache(cacheKey: string): void {
    this.cursorCache.delete(cacheKey);
    logger.debug(`[TxCacheManager] Cursor cache cleared for key: ${cacheKey}`);
  }
  
  /**
   * Start periodic cleanup of expired cache entries
   * This prevents memory leaks from unused cache entries
   */
  private startPeriodicCleanup(): void {
    const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
    
    setInterval(() => {
      const now = Date.now();
      let hotDeleted = 0;
      let warmDeleted = 0;
      let cursorDeleted = 0;
      
      // Clean hot cache
      for (const [key, item] of this.hotCache.entries()) {
        if (now - item.timestamp > this.HOT_CACHE_TTL * 3) { // 3x TTL for safety
          this.hotCache.delete(key);
          hotDeleted++;
        }
      }
      
      // Clean warm cache
      for (const [key, item] of this.warmCache.entries()) {
        if (now - item.timestamp > this.WARM_CACHE_TTL * 3) { // 3x TTL for safety
          this.warmCache.delete(key);
          warmDeleted++;
        }
      }
      
      // Clean cursor cache
      for (const [key, item] of this.cursorCache.entries()) {
        if (now - item.timestamp > this.CURSOR_CACHE_TTL * 3) { // 3x TTL for safety
          this.cursorCache.delete(key);
          cursorDeleted++;
        }
      }
      
      if (hotDeleted || warmDeleted || cursorDeleted) {
        logger.info(`[TxCacheManager] Cache cleanup: removed ${hotDeleted} hot, ${warmDeleted} warm, ${cursorDeleted} cursor entries`);
      }
    }, CLEANUP_INTERVAL);
  }
} 