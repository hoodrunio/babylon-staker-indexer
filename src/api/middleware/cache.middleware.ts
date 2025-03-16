import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
import crypto from 'crypto';

// Simple in-memory cache
const memoryCache = new Map<string, { data: any, timestamp: number, etag: string }>();

/**
 * Generates ETag value for the response
 * @param data Response data
 * @returns ETag value
 */
const generateETag = (data: any): string => {
    const hash = crypto.createHash('md5');
    hash.update(JSON.stringify(data));
    return `"${hash.digest('hex')}"`;
};

/**
 * Express middleware for caching responses
 * @param ttlSeconds Cache time to live in seconds
 */
export const cacheMiddleware = (ttlSeconds: number) => {
    return (req: Request, res: Response, next: NextFunction) => {
        // Create cache key (URL + query params)
        const cacheKey = `${req.originalUrl || req.url}`;
        const cachedResponse = memoryCache.get(cacheKey);
        
        // Current time
        const now = Date.now();
        
        // If it exists in the cache and has not expired
        if (cachedResponse && (now - cachedResponse.timestamp) < ttlSeconds * 1000) {
            // Check the If-None-Match header sent by the client
            const ifNoneMatch = req.headers['if-none-match'];
            
            // If the ETag matches, send a 304 Not Modified response
            if (ifNoneMatch && ifNoneMatch === cachedResponse.etag) {
                logger.debug(`[CacheMiddleware] ETag match for ${cacheKey}, returning 304`);
                return res.status(304).end();
            }
            
            logger.debug(`[CacheMiddleware] Cache hit for ${cacheKey}`);
            
            // Add ETag header
            res.setHeader('ETag', cachedResponse.etag);
            res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}`);
            
            // Return response from cache
            return res.status(200).json({
                ...cachedResponse.data,
                meta: {
                    ...(cachedResponse.data.meta || {}),
                    fromCache: true,
                    cachedAt: new Date(cachedResponse.timestamp).toISOString()
                }
            });
        }
        
        // Store the original json method
        const originalJson = res.json;
        
        // Override the json method
        res.json = function(body: any): Response {
            // Create ETag
            const etag = generateETag(body);
            
            // Add ETag header
            this.setHeader('ETag', etag);
            this.setHeader('Cache-Control', `public, max-age=${ttlSeconds}`);
            
            // Call the original json method
            const response = originalJson.call(this, body);
            
            // Cache the response
            if (res.statusCode === 200) {
                logger.debug(`[CacheMiddleware] Caching response for ${cacheKey}`);
                memoryCache.set(cacheKey, {
                    data: body,
                    timestamp: now,
                    etag
                });
            }
            
            return response;
        };
        
        next();
    };
};

/**
 * Clear cache
 */
export const clearCache = (): void => {
    memoryCache.clear();
    logger.info('[CacheMiddleware] Cache cleared');
};