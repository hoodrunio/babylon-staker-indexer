import { Router } from 'express';
import { BTCDelegationController } from '../../controllers/btc-delegations/BTCDelegationController';
import { networkSelector } from '../../middleware/network-selector';

const router = Router();

// Yeni route (query parameter ile)
router.get('/', networkSelector, BTCDelegationController.getDelegationsByStatus);

// Eski route yapısını da destekle (geriye dönük uyumluluk için)
router.get('/status', networkSelector, BTCDelegationController.getDelegationsByStatus);

// Staker address'e göre delegasyonları getir
router.get('/staker/:stakerAddress', networkSelector, BTCDelegationController.getDelegationsByStakerAddress);

// Tek bir delegasyonu getir
router.get('/tx/:txHash', networkSelector, BTCDelegationController.getDelegationByTxHash);

export default router; 