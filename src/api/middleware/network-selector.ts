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
    // Get network from query or header
    // First get the raw input without toLowerCase() to avoid errors with enum values
    const rawNetworkInput = (req.query.network as string) || (req.headers['x-network'] as string) || Network.TESTNET;
    
    // Convert to string before calling toLowerCase() to handle enum values
    const networkInput = typeof rawNetworkInput === 'string' ? 
        rawNetworkInput.toLowerCase() : 
        String(rawNetworkInput).toLowerCase();
    
    // Map the lowercase input to the correct Network enum value
    let network: Network;
    if (networkInput === 'mainnet') {
        network = Network.MAINNET;
    } else if (networkInput === 'testnet') {
        network = Network.TESTNET;
    } else {
        return res.status(400).json({
            error: 'Invalid network specified. Must be either mainnet or testnet'
        });
    }
    
    req.network = network;
    next();
}; 