import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export class CacheService {
  private static instance: CacheService;
  private client: RedisClientType;
  private readonly defaultTTL = 300; // 5 minutes in seconds
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  private constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    this.client.on('error', (err) => {
      logger.error('Redis Client Error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      logger.info('Redis client connected successfully');
      this.isConnected = true;
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });

    this.connectionPromise = this.connect();
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.isConnected = true;
    } catch (error) {
      logger.error('Redis connection error:', error);
      this.isConnected = false;
      throw error;
    }
  }

  private async ensureConnection(): Promise<boolean> {
    if (this.isConnected) return true;
    
    if (this.connectionPromise) {
      try {
        await this.connectionPromise;
        return true;
      } catch (error) {
        this.connectionPromise = null;
      }
    }

    this.connectionPromise = this.connect();
    try {
      await this.connectionPromise;
      return true;
    } catch (error) {
      return false;
    }
  }

  private async retryOperation<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const connected = await this.ensureConnection();
        if (!connected) {
          logger.warn(`Redis not connected on attempt ${attempt}/${this.maxRetries}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
          continue;
        }
        
        return await operation();
      } catch (error) {
        if (attempt === this.maxRetries) {
          logger.error(`Redis operation failed after ${this.maxRetries} attempts:`, error);
          return fallback;
        }
        
        logger.warn(`Redis operation failed on attempt ${attempt}/${this.maxRetries}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
      }
    }
    
    return fallback;
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  async get<T>(key: string): Promise<T | null> {
    return this.retryOperation(async () => {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    }, null);
  }

  async set(key: string, value: any, ttl: number = this.defaultTTL): Promise<boolean> {
    return this.retryOperation(async () => {
      const stringValue = JSON.stringify(value);
      if (ttl === undefined) {
        await this.client.set(key, stringValue);
      } else {
        await this.client.set(key, stringValue, { EX: ttl });
      }
      return true;
    }, false);
  }

  async del(key: string): Promise<boolean> {
    return this.retryOperation(async () => {
      await this.client.del(key);
      return true;
    }, false);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.retryOperation(async () => {
      return await this.client.keys(pattern);
    }, []);
  }

  async clearPattern(pattern: string): Promise<boolean> {
    return this.retryOperation(async () => {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    }, false);
  }

  generateKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.entries(params)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}:${value}`)
      .join(':');
    return `${prefix}:${sortedParams}`;
  }
} 