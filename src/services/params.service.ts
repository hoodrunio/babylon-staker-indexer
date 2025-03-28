import { BabylonClient } from '../clients/BabylonClient';
import { Network } from '../types/finality';
import { CacheService } from './CacheService';
import { logger } from '../utils/logger';

class ParamsService {
  private static readonly CACHE_TTL = 7200; // 2 hours in seconds
  private static readonly CACHE_KEY_PREFIX = 'params:';

  private static getClient(network?: Network): BabylonClient {
    try {
      return BabylonClient.getInstance(network || Network.TESTNET);
    } catch (error) {
      if (!network) {
        // If no specific network was requested, try testnet as fallback
        try {
          return BabylonClient.getInstance(Network.TESTNET);
        } catch (error) {
          throw new Error('Neither mainnet nor testnet is configured. Please configure at least one network in your environment variables.');
        }
      }
      throw error;
    }
  }

  private static getCacheKey(network: Network): string {
    return `${this.CACHE_KEY_PREFIX}${network}`;
  }

  static async getAllParams(network?: Network) {
    try {
      const client = ParamsService.getClient(network);
      const actualNetwork = client.getNetwork();
      const cacheKey = this.getCacheKey(actualNetwork);
      
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
        network: actualNetwork,
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
