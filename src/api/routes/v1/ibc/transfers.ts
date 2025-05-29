import { Router } from 'express';
import { IBCTransferController } from '../../../controllers/ibc/ibc-transfer.controller';
import { networkSelector } from '../../../middleware/network-selector';

const router = Router();

// Get transfer statistics - Özel route'ları önce tanımlayalım
router.get('/stats', networkSelector, IBCTransferController.getTransferStats);
// Get transfers by receiver address
router.get('/receiver/:address', networkSelector, IBCTransferController.getTransfersByReceiver);
// Get transfers between specific chains
router.get('/chains/:sourceChain/:destChain', networkSelector, IBCTransferController.getTransfersByChains);

export default router; 