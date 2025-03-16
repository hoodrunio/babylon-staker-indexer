import { Router } from 'express';
import { CovenantController } from '../../controllers/covenant.controller';

const router = Router();
const controller = new CovenantController();

// Get all covenant members
router.get('/members', controller.getCovenantMembers);

// Get signature statistics for a specific member
router.get('/members/:publicKey/stats', controller.getMemberStats);

// Get signature status for a specific transaction
router.get('/transactions/:txHash', controller.getTransactionSignatures);

// Get signature status for last N transactions
router.get('/transactions', controller.getRecentTransactions);

// Get summary statistics
router.get('/stats', controller.getSummaryStats);

export default router; 