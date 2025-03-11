import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
import crypto from 'crypto';

// Basit bir bellek içi önbellek
const memoryCache = new Map<string, { data: any, timestamp: number, etag: string }>();

/**
 * ETag oluştur
 * @param data Veri
 * @returns ETag değeri
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
        // Önbellek anahtarı oluştur (URL + query params)
        const cacheKey = `${req.originalUrl || req.url}`;
        const cachedResponse = memoryCache.get(cacheKey);
        
        // Şu anki zaman
        const now = Date.now();
        
        // Önbellekte varsa ve süresi dolmamışsa
        if (cachedResponse && (now - cachedResponse.timestamp) < ttlSeconds * 1000) {
            // İstemcinin gönderdiği If-None-Match header'ını kontrol et
            const ifNoneMatch = req.headers['if-none-match'];
            
            // ETag eşleşiyorsa 304 Not Modified yanıtı gönder
            if (ifNoneMatch && ifNoneMatch === cachedResponse.etag) {
                logger.debug(`[CacheMiddleware] ETag match for ${cacheKey}, returning 304`);
                return res.status(304).end();
            }
            
            logger.debug(`[CacheMiddleware] Cache hit for ${cacheKey}`);
            
            // ETag header'ını ekle
            res.setHeader('ETag', cachedResponse.etag);
            res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}`);
            
            // Önbellekten yanıt döndür
            return res.status(200).json({
                ...cachedResponse.data,
                meta: {
                    ...(cachedResponse.data.meta || {}),
                    fromCache: true,
                    cachedAt: new Date(cachedResponse.timestamp).toISOString()
                }
            });
        }
        
        // Orijinal json metodunu sakla
        const originalJson = res.json;
        
        // json metodunu override et
        res.json = function(body: any): Response {
            // ETag oluştur
            const etag = generateETag(body);
            
            // ETag header'ını ekle
            this.setHeader('ETag', etag);
            this.setHeader('Cache-Control', `public, max-age=${ttlSeconds}`);
            
            // Orijinal json metodunu çağır
            const response = originalJson.call(this, body);
            
            // Yanıtı önbelleğe al
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
 * Önbelleği temizle
 */
export const clearCache = (): void => {
    memoryCache.clear();
    logger.info('[CacheMiddleware] Cache cleared');
}; 