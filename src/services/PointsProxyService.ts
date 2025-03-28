import axios, { AxiosError } from 'axios';
import { CacheService } from './CacheService';
import { FinalityProviderService } from '../database/services/FinalityProviderService';
import { logger } from '../utils/logger';

interface PointsResponse {
  finality_provider_pk_hex: string;
  points: number;
  exists: boolean; // To track data existence status
}

interface PointsResult {
  success: boolean;
  data: PointsResponse | null;
  fpPkHex: string;
  error?: string;
}

export class PointsProxyService {
  private static instance: PointsProxyService;
  private readonly baseUrl = process.env.POINTS_PROXY_URL;
  private readonly cacheService: CacheService;
  private readonly finalityProviderService: FinalityProviderService;
  private readonly cacheTTL = 21600; // 6 hours cache
  private readonly noDataCacheTTL = 43200; // 12 hours cache (for cases with no data)
  private readonly requestDelay = 2000; // 2 seconds wait between requests
  private readonly updateInterval = 3600000; // 1 hour
  private readonly maxRetries = 3;
  private readonly batchSize = 200; // Number of parallel requests
  private isUpdating = false;

  private constructor() {
    this.cacheService = CacheService.getInstance();
    this.finalityProviderService = new FinalityProviderService();
    this.startPeriodicUpdate();
  }

  public static getInstance(): PointsProxyService {
    if (!PointsProxyService.instance) {
      PointsProxyService.instance = new PointsProxyService();
    }
    return PointsProxyService.instance;
  }

  private formatPublicKey(pkHex: string): string {
    return pkHex.replace('0x', '').toLowerCase();
  }

  private async startPeriodicUpdate() {
    // Fill the cache on first run
    await this.updateAllPointsCache().catch(logger.error);

    // Start periodic updates
    setInterval(async () => {
      await this.updateAllPointsCache();
    }, this.updateInterval);
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async handleRateLimit(error: AxiosError) {
    const retryAfter = error.response?.headers?.['retry-after'];
    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : this.requestDelay * 2;
    await this.sleep(waitTime);
  }

  private async processBatch(fpAddresses: string[]): Promise<void> {
    const promises = fpAddresses.map(async (fpPkHex) => {
      let retries = 0;
      while (retries < this.maxRetries) {
        try {
          await this.updateSingleFPCache(fpPkHex);
          break;
        } catch (error) {
          if (error instanceof AxiosError && error.response?.status === 429) {
            retries++;
            if (retries < this.maxRetries) {
              await this.handleRateLimit(error);
              continue;
            }
          }
          logger.error(`Error updating cache for FP ${fpPkHex}:`, error instanceof Error ? error.message : 'Unknown error');
          break;
        }
      }
    });

    await Promise.all(promises);
  }

  private async updateAllPointsCache() {
    if (this.isUpdating) {
      logger.info('Cache update already in progress, skipping...');
      return;
    }

    try {
      this.isUpdating = true;
      logger.info('Starting cache update for all FPs...');

      const totalCount = await this.finalityProviderService.getFinalityProvidersCount();
      if (totalCount <= 0) {
        logger.info('No finality providers found, skipping cache update');
        return;
      }

      const fps = await this.finalityProviderService.getAllFPs(0, Math.max(totalCount, 1));
      const fpAddresses = fps.map(fp => fp.address);

      // Batch processing
      for (let i = 0; i < fpAddresses.length; i += this.batchSize) {
        const batch = fpAddresses.slice(i, i + this.batchSize);
        await this.processBatch(batch);
        if (i + this.batchSize < fpAddresses.length) {
          await this.sleep(this.requestDelay);
        }
      }

      logger.info('Cache update completed for all FPs');
    } catch (error) {
      logger.error('Error in periodic cache update:', error);
    } finally {
      this.isUpdating = false;
    }
  }

  private async updateSingleFPCache(fpPkHex: string): Promise<void> {
    const formattedPkHex = this.formatPublicKey(fpPkHex);
    const cacheKey = this.cacheService.generateKey('fp_points', { fpPkHex: formattedPkHex });

    try {
      const response = await axios.get(`${this.baseUrl}/v1/points/finality-providers`, {
        params: {
          finality_provider_pk_hex: formattedPkHex
        }
      });

      if (response.data?.data?.[0]) {
        const pointsData = response.data.data[0];
        const data: PointsResponse = {
          finality_provider_pk_hex: formattedPkHex,
          points: pointsData.points || 0,
          exists: true
        };
        await this.cacheService.set(cacheKey, data, this.cacheTTL);
      } else {
        // If there is no data, cache this too
        const noDataResponse: PointsResponse = {
          finality_provider_pk_hex: formattedPkHex,
          points: 0,
          exists: false
        };
        await this.cacheService.set(cacheKey, noDataResponse, this.noDataCacheTTL);
      }
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 429) {
        throw error;
      }
      logger.error(`Failed to update cache for FP ${formattedPkHex}:`, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async getFinalityProviderPoints(fpPkHex: string): Promise<PointsResponse | null> {
    const formattedPkHex = this.formatPublicKey(fpPkHex);
    const cacheKey = this.cacheService.generateKey('fp_points', { fpPkHex: formattedPkHex });
    
    // Read from cache
    const cachedData = await this.cacheService.get<PointsResponse>(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    // If not in cache, get from API
    let retries = 0;
    while (retries < this.maxRetries) {
      try {
        const response = await axios.get(`${this.baseUrl}/v1/points/finality-providers`, {
          params: {
            finality_provider_pk_hex: formattedPkHex
          }
        });

        if (!response.data?.data || !Array.isArray(response.data.data)) {
          const noDataResponse: PointsResponse = {
            finality_provider_pk_hex: formattedPkHex,
            points: 0,
            exists: false
          };
          await this.cacheService.set(cacheKey, noDataResponse, this.noDataCacheTTL);
          return noDataResponse;
        }

        if (response.data.data.length === 0) {
          const noDataResponse: PointsResponse = {
            finality_provider_pk_hex: formattedPkHex,
            points: 0,
            exists: false
          };
          await this.cacheService.set(cacheKey, noDataResponse, this.noDataCacheTTL);
          return noDataResponse;
        }

        const pointsData = response.data.data[0];
        const data: PointsResponse = {
          finality_provider_pk_hex: formattedPkHex,
          points: pointsData.points || 0,
          exists: true
        };

        await this.cacheService.set(cacheKey, data, this.cacheTTL);
        return data;
      } catch (error) {
        if (error instanceof AxiosError) {
          if (error.response?.status === 429) {
            retries++;
            if (retries < this.maxRetries) {
              await this.handleRateLimit(error);
              continue;
            }
          }
        }
        return null;
      }
    }
    return null;
  }

  async getFinalityProvidersPoints(fpPkHexList: string[]): Promise<PointsResult[]> {
    // First check all caches
    const results = await Promise.all(fpPkHexList.map(async fpPkHex => {
      const formattedPkHex = this.formatPublicKey(fpPkHex);
      const cacheKey = this.cacheService.generateKey('fp_points', { fpPkHex: formattedPkHex });
      const cachedData = await this.cacheService.get<PointsResponse>(cacheKey);
      
      if (cachedData) {
        return {
          success: true,
          data: cachedData,
          fpPkHex,
          error: !cachedData.exists ? 'No points data available' : undefined
        } as PointsResult;
      }
      
      return null;
    }));

    // Make API request for FPs not in cache
    const missingFPs = fpPkHexList.filter((_, index) => !results[index]);
    const batchResults: PointsResult[] = [];

    for (let i = 0; i < missingFPs.length; i += this.batchSize) {
      const batch = missingFPs.slice(i, i + this.batchSize);
      const batchPromises = batch.map(fpPkHex => this.getFinalityProviderPoints(fpPkHex));
      
      await this.sleep(this.requestDelay);
      const batchData = await Promise.all(batchPromises);
      
      batchResults.push(...batchData.map((data, index) => ({
        success: true,
        data,
        fpPkHex: batch[index],
        error: data && !data.exists ? 'No points data available' : undefined
      })));
    }

    // Combine results
    return results.map((result, index) => {
      if (result) return result;
      return batchResults.find(r => r.fpPkHex === fpPkHexList[index]) || {
        success: false,
        data: null,
        fpPkHex: fpPkHexList[index],
        error: 'Failed to fetch data'
      };
    });
  }
}