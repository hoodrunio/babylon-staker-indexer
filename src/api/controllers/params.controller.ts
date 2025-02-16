import { Request, Response } from 'express';
import ParamsService from '../../services/params.service';
import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
class ParamsController {
  static async getAllParams(req: Request, res: Response) {
    try {
      const network = req.query.network?.toString().toLowerCase();
      let targetNetwork: Network | undefined;

      if (network) {
        if (network === 'mainnet') {
          targetNetwork = Network.MAINNET;
        } else if (network === 'testnet') {
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
}

export default ParamsController;
