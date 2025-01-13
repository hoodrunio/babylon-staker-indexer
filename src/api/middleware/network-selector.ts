import { Request, Response, NextFunction } from 'express';

export enum Network {
    MAINNET = 'mainnet',
    TESTNET = 'testnet'
}

// Extend Express Request type to include network
declare global {
    namespace Express {
        interface Request {
            network?: Network;
        }
    }
}

export const networkSelector = (req: Request, res: Response, next: NextFunction) => {
    const network = (req.headers['x-network'] as Network) || Network.MAINNET;
    
    if (network && !Object.values(Network).includes(network as Network)) {
        return res.status(400).json({
            error: 'Invalid network specified. Must be either mainnet or testnet'
        });
    }
    
    req.network = network as Network;
    next();
}; 