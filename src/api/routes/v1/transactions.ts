import { Router } from 'express';
import { TransactionController } from '../../controllers/blockchain/TransactionController';
import { networkSelector } from '../../middleware/network-selector';

const router = Router();

// Get blockchain transactions with filtering
router.get('/', networkSelector, TransactionController.getTransactions);

export default router; 