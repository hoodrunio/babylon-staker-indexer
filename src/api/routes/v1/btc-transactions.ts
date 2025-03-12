import { Router } from 'express';
import { BTCTransactionController } from '../../controllers/btc-delegations/BTCTransactionController';
import { networkSelector } from '../../middleware/network-selector';

const router = Router();

// Get BTC transactions with filtering
router.get('/', networkSelector, BTCTransactionController.getBTCTransactions);

export default router; 