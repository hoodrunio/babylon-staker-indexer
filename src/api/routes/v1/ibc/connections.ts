import { Router } from 'express';
import { IBCConnectionController } from '../../../controllers/ibc/ibc-connection.controller';
import { networkSelector } from '../../../middleware/network-selector';

const router = Router();

// Get all connections
router.get('/', networkSelector, IBCConnectionController.getAllConnections);

// Get connection statistics
router.get('/stats', networkSelector, IBCConnectionController.getConnectionStats);

// Get connections by counterparty chain
router.get('/counterparty/:chainId', networkSelector, IBCConnectionController.getConnectionsByCounterparty);

// Get connection by ID
router.get('/:connectionId', networkSelector, IBCConnectionController.getConnection);

export default router; 