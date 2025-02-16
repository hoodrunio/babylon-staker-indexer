import { Router } from 'express';
import { CovenantController } from '../../controllers/CovenantController';

const router = Router();
const controller = new CovenantController();

// Tüm covenant üyelerini getir
router.get('/members', controller.getCovenantMembers);

// Belirli bir üyenin imza istatistiklerini getir
router.get('/members/:publicKey/stats', controller.getMemberStats);

// Belirli bir transaction için imza durumlarını getir
router.get('/transactions/:txHash', controller.getTransactionSignatures);

// Son N transaction'ın imza durumlarını getir
router.get('/transactions', controller.getRecentTransactions);

// Özet istatistikleri getir
router.get('/stats', controller.getSummaryStats);

export default router; 