import { Router } from 'express';
import { BBNTransactionController } from '../controllers/bbn/BBNTransactionController';
import { BBNStakeController } from '../controllers/bbn/BBNStakeController';
import { asyncHandler } from '../middleware/asyncHandler';
import { setNetwork } from '../middleware/networkMiddleware';

const router = Router();

// Set network middleware for all routes
router.use(setNetwork);

// Transaction routes
router.get('/transactions', asyncHandler(BBNTransactionController.getTransactions));
router.get('/transactions/:txHash', asyncHandler(BBNTransactionController.getTransactionByHash));
router.get('/address/:address/transactions', asyncHandler(BBNTransactionController.getTransactionsByAddress));

// Transaction statistics routes
router.get('/stats/transactions/daily', asyncHandler(BBNTransactionController.getDailyStats));
router.get('/stats/transactions/weekly', asyncHandler(BBNTransactionController.getWeeklyStats));
router.get('/stats/transactions/monthly', asyncHandler(BBNTransactionController.getMonthlyStats));
router.get('/stats/transactions/all-time', asyncHandler(BBNTransactionController.getAllTimeStats));
router.post('/stats/transactions/recalculate', asyncHandler(BBNTransactionController.recalculateStats));

// Stake routes
router.get('/stakes', asyncHandler(BBNStakeController.getStakes));
router.get('/stakes/:txHash', asyncHandler(BBNStakeController.getStakeByTxHash));
router.get('/staker/:address/stakes', asyncHandler(BBNStakeController.getStakesByStakerAddress));
router.get('/validator/:address/stakes', asyncHandler(BBNStakeController.getStakesByValidatorAddress));

// Stake statistics routes
router.get('/stats/stakes/daily', asyncHandler(BBNStakeController.getDailyStats));
router.get('/stats/stakes/weekly', asyncHandler(BBNStakeController.getWeeklyStats));
router.get('/stats/stakes/monthly', asyncHandler(BBNStakeController.getMonthlyStats));
router.get('/stats/stakes/all-time', asyncHandler(BBNStakeController.getAllTimeStats));
router.post('/stats/stakes/recalculate', asyncHandler(BBNStakeController.recalculateStats));

export default router; 