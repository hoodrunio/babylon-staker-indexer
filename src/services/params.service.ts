import { BabylonClient } from '../clients/BabylonClient';
import { CacheService } from './CacheService';
import { logger } from '../utils/logger';

class ParamsService {
  private static readonly CACHE_TTL = 7200; // 2 hours in seconds
  private static readonly CACHE_KEY_PREFIX = 'params:';

  private static getClient(): BabylonClient {
    // Get the singleton instance from environment configuration
    return BabylonClient.getInstance();
    // The getInstance method handles configuration and proper error messages internally
  }

  private static getCacheKey(): string {
    return this.CACHE_KEY_PREFIX;
  }

  static async getAllParams() {
    try {
      const client = ParamsService.getClient();
      const actualNetwork = client.getNetwork();
      const cacheKey = this.getCacheKey();
      
      // Try to get from cache first
      const cacheService = CacheService.getInstance();
      const cachedParams = await cacheService.get(cacheKey);
      
      if (cachedParams) {
        return cachedParams;
      }

      // If not in cache, fetch from API
      // Babylon Bitcoin protocol specific parameters
      const [
        btccheckpointParams,
        btclightclientParams,
        btcstakingParams,
        epochingParams,
        finalityParams,
        incentiveParams
      ] = await Promise.all([
        client.getModuleParams('btccheckpoint'),
        client.getModuleParams('btclightclient'),
        client.getModuleParams('btcstaking'),
        client.getModuleParams('epoching'),
        client.getModuleParams('finality'),
        client.getIncentiveParams()
      ]);

      // Cosmos SDK parameters
      const [
        slashingParams,
        stakingParams,
        mintingParams,
        governanceParams,
        distributionParams
      ] = await Promise.all([
        client.getSlashingParams(),
        client.getStakingParams(),
        client.getMintParams(),
        client.getGovParams(),
        client.getDistributionParams()
      ]);

      const params = {
        network: actualNetwork, // Keep network for reference, but we're using a single-network setup
        // Babylon Bitcoin protocol specific parameters
        btccheckpoint: btccheckpointParams,
        btclightclient: btclightclientParams,
        btcstaking: btcstakingParams,
        epoching: epochingParams,
        finality: finalityParams,
        incentive: incentiveParams,
        // Cosmos SDK parameters
        slashing: slashingParams,
        staking: stakingParams,
        mint: mintingParams,
        gov: governanceParams,
        distribution: distributionParams
      };

      // Cache the results
      await cacheService.set(cacheKey, params, this.CACHE_TTL);

      return params;
    } catch (error) {
      logger.error('Error fetching parameters:', error);
      throw error;
    }
  }
}

export default ParamsService;
