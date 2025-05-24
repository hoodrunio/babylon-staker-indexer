import { Router } from 'express';
import { IBCClientController } from '../../../controllers/ibc/ibc-client.controller';
import { networkSelector } from '../../../middleware/network-selector';

const router = Router();

// Get all clients
router.get('/', networkSelector, IBCClientController.getAllClients);

// Get client statistics
router.get('/stats', networkSelector, IBCClientController.getClientStats);

// Get clients by chain ID
router.get('/chain/:chainId', networkSelector, IBCClientController.getClientsByChain);

// Get client by ID
router.get('/:clientId', networkSelector, IBCClientController.getClient);

export default router; 