import { Router } from 'express';
import { IBCRelayerController } from '../../../controllers/ibc/ibc-relayer.controller';
import { networkSelector } from '../../../middleware/network-selector';

const router = Router();

// Get top relayers by activity
router.get('/top', networkSelector, IBCRelayerController.getTopRelayers);

// Get relayers by chain
router.get('/chain/:chainId', networkSelector, IBCRelayerController.getRelayersByChain);

// Get relayer statistics by address
router.get('/:address', networkSelector, IBCRelayerController.getRelayerStats);

export default router; 