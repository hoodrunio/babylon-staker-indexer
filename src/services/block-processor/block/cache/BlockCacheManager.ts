/**
 * Block Cache Manager
 * Handles caching for block data
 */

import { PaginatedBlocksResponse } from '../../types/common';

export class BlockCacheManager {
  private static instance: BlockCacheManager | null = null;
  
  // Cache for block queries
  private blockCache: Map<string, { data: any, timestamp: number }> = new Map();
  private readonly CACHE_TTL = 10 * 1000; // 10 seconds cache duration
  
  // Cache for paginated blocks
  private paginatedBlocksCache: Map<string, { data: PaginatedBlocksResponse, timestamp: number }> = new Map();
  private readonly PAGINATED_BLOCKS_CACHE_TTL = 10 * 1000; // 10 seconds cache duration
  
  private constructor() {
    // Private constructor to enforce singleton pattern
  }
  
  /**
   * Singleton instance
   */
  public static getInstance(): BlockCacheManager {
    if (!BlockCacheManager.instance) {
      BlockCacheManager.instance = new BlockCacheManager();
    }
    return BlockCacheManager.instance;
  }
  
  /**
   * Gets cached block data if available
   * @param cacheKey Cache key
   * @returns Cached data or null if not found or expired
   */
  public getCachedBlock(cacheKey: string): any | null {
    const cachedData = this.blockCache.get(cacheKey);
    const now = Date.now();
    
    if (cachedData && (now - cachedData.timestamp) < this.CACHE_TTL) {
      //logger.debug(`[BlockCacheManager] Returning cached block for key: ${cacheKey}`);
      return cachedData.data;
    }
    
    return null;
  }
  
  /**
   * Caches block data
   * @param cacheKey Cache key
   * @param data Data to cache
   */
  public cacheBlock(cacheKey: string, data: any): void {
    this.blockCache.set(cacheKey, { 
      data, 
      timestamp: Date.now() 
    });
    //logger.debug(`[BlockCacheManager] Cached block for key: ${cacheKey}`);
  }
  
  /**
   * Gets cached paginated blocks if available
   * @param cacheKey Cache key
   * @returns Cached data or null if not found or expired
   */
  public getCachedPaginatedBlocks(cacheKey: string): PaginatedBlocksResponse | null {
    const cachedData = this.paginatedBlocksCache.get(cacheKey);
    const now = Date.now();
    
    if (cachedData && (now - cachedData.timestamp) < this.PAGINATED_BLOCKS_CACHE_TTL) {
      //logger.debug(`[BlockCacheManager] Returning cached paginated blocks for key: ${cacheKey}`);
      return cachedData.data;
    }
    
    return null;
  }
  
  /**
   * Caches paginated blocks
   * @param cacheKey Cache key
   * @param data Data to cache
   */
  public cachePaginatedBlocks(cacheKey: string, data: PaginatedBlocksResponse): void {
    this.paginatedBlocksCache.set(cacheKey, { 
      data, 
      timestamp: Date.now() 
    });
    //logger.debug(`[BlockCacheManager] Cached paginated blocks for key: ${cacheKey}`);
  }
  
  /**
   * Clears all caches
   */
  public clearAllCaches(): void {
    this.blockCache.clear();
    this.paginatedBlocksCache.clear();
    //logger.info(`[BlockCacheManager] All caches cleared`);
  }
  
  /**
   * Clears block cache for a specific key
   * @param cacheKey Cache key
   */
  public clearBlockCache(cacheKey: string): void {
    this.blockCache.delete(cacheKey);
    //logger.debug(`[BlockCacheManager] Block cache cleared for key: ${cacheKey}`);
  }
  
  /**
   * Clears paginated blocks cache for a specific key
   * @param cacheKey Cache key
   */
  public clearPaginatedBlocksCache(cacheKey: string): void {
    this.paginatedBlocksCache.delete(cacheKey);
    //logger.debug(`[BlockCacheManager] Paginated blocks cache cleared for key: ${cacheKey}`);
  }
} 