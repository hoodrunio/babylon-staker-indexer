import { Request, Response, NextFunction } from 'express';
import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';

/**
 * Middleware to set the network type based on the request query or default to MAINNET
 */
export const setNetwork = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Get network from query param or default to MAINNET
        const networkParam = req.query.network as string;
        
        if (networkParam) {
            // Lowercase network param for case-insensitive comparison
            const networkLower = networkParam.toLowerCase();
            
            // Check if the network is valid using case-insensitive comparison
            if (networkLower === 'testnet') {
                req.network = Network.TESTNET;
                logger.debug(`Network set to ${req.network}`);
            } else if (networkLower === 'mainnet') {
                req.network = Network.MAINNET;
                logger.debug(`Network set to ${req.network}`);
            } else {
                logger.warn(`Invalid network specified: ${networkParam}, defaulting to MAINNET`);
                req.network = Network.MAINNET;
            }
        } else {
            req.network = Network.MAINNET;
        }
        
        next();
    } catch (error) {
        logger.error('Error in network middleware:', error);
        req.network = Network.MAINNET;
        next();
    }
}; 