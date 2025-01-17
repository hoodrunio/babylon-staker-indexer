import express from 'express';
import { BTCDelegationController } from '../../controllers/btc-delegations/BTCDelegationController';
import { networkSelector } from '../../middleware/network-selector';

const router = express.Router();
const controller = BTCDelegationController.getInstance();

// Tüm delegasyonları getir (status'e göre filtrelenmiş)
router.get(
    '/status',
    networkSelector,
    controller.getDelegationsByStatus.bind(controller)
);

// Tek bir delegasyonu getir
router.get(
    '/:txHash',
    networkSelector,
    controller.getDelegationByTxHash.bind(controller)
);

export default router; 