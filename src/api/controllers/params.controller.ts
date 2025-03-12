import { Request, Response } from 'express';
import ParamsService from '../../services/params.service';
import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';

// Params tipini tanımlayalım
interface ParamsResponse {
  network: Network;
  btccheckpoint?: any;
  btclightclient?: any;
  btcstaking?: any;
  epoching?: any;
  finality?: any;
  incentive?: any;
  slashing?: any;
  staking?: any;
  mint?: any;
  gov?: any;
  distribution?: any;
  [key: string]: any; // Diğer modüller için index signature
}

class ParamsController {
  static async getAllParams(req: Request, res: Response) {
    try {
      const networkInput = req.query.network?.toString().toLowerCase();
      let targetNetwork: Network | undefined;

      if (networkInput) {
        if (networkInput === 'mainnet') {
          targetNetwork = Network.MAINNET;
        } else if (networkInput === 'testnet') {
          targetNetwork = Network.TESTNET;
        } else {
          return res.status(400).json({ 
            error: 'Invalid network parameter. Use "mainnet" or "testnet".' 
          });
        }
      }

      const params = await ParamsService.getAllParams(targetNetwork);
      res.json(params);
    } catch (error) {
      logger.error('Error in getAllParams:', error);
      if (error instanceof Error && error.message.includes('is not configured')) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  static async getSpecificParams(req: Request, res: Response) {
    try {
      const { module } = req.params;
      const networkInput = req.query.network?.toString().toLowerCase();
      let targetNetwork: Network | undefined;

      if (networkInput) {
        if (networkInput === 'mainnet') {
          targetNetwork = Network.MAINNET;
        } else if (networkInput === 'testnet') {
          targetNetwork = Network.TESTNET;
        } else {
          return res.status(400).json({ 
            error: 'Invalid network parameter. Use "mainnet" or "testnet".' 
          });
        }
      }

      // Validate module parameter
      const validModules = [
        // Babylon Bitcoin protocol specific modules
        'btccheckpoint', 'btclightclient', 'btcstaking', 'epoching', 'finality', 'incentive',
        // Cosmos SDK modules
        'slashing', 'staking', 'mint', 'gov', 'distribution'
      ];

      if (!validModules.includes(module)) {
        return res.status(400).json({
          error: `Invalid module parameter. Valid modules are: ${validModules.join(', ')}`
        });
      }

      const allParams = await ParamsService.getAllParams(targetNetwork) as ParamsResponse;
      
      if (!allParams[module]) {
        return res.status(404).json({
          error: `Parameters for module '${module}' not found`
        });
      }

      res.json({
        network: allParams.network,
        [module]: allParams[module]
      });
    } catch (error) {
      logger.error(`Error in getSpecificParams for module:`, error);
      if (error instanceof Error && error.message.includes('is not configured')) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}

export default ParamsController;
