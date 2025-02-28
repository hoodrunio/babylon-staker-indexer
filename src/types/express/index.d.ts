import { Network } from '../finality';

// Extend Express Request interface
declare global {
    namespace Express {
        interface Request {
            network?: Network;
        }
    }
} 