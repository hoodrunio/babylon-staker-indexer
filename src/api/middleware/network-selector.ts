import { Request, Response, NextFunction } from 'express';
import { Network } from '../../types/finality';

// Extend Express Request type to include network
declare global {
    namespace Express {
        interface Request {
            network?: Network;
        }
    }
}

export const networkSelector = (req: Request, res: Response, next: NextFunction) => {
    // Check both query parameter and header for network
    const network = (
        (req.query.network as Network) || 
        (req.headers['x-network'] as Network) || 
        Network.TESTNET
    ).toLowerCase() as Network;
    
    if (network && !Object.values(Network).includes(network as Network)) {
        return res.status(400).json({
            error: 'Invalid network specified. Must be either mainnet or testnet'
        });
    }
    
    req.network = network as Network;
    next();
}; 