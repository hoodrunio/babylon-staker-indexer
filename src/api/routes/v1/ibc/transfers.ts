import { Router } from 'express';
import { IBCTransferController } from '../../../controllers/ibc/ibc-transfer.controller';
import { networkSelector } from '../../../middleware/network-selector';

const router = Router();

// Get transfer statistics - Özel route'ları önce tanımlayalım
router.get('/stats', networkSelector, IBCTransferController.getTransferStats);

// Get transfer by transaction hash
router.get('/tx/:txHash', networkSelector, IBCTransferController.getTransferByTxHash);

// Get transfers by sender address
router.get('/sender/:address', networkSelector, IBCTransferController.getTransfersBySender);

// Get transfers by receiver address
router.get('/receiver/:address', networkSelector, IBCTransferController.getTransfersByReceiver);

// Get transfers between specific chains
router.get('/chains/:sourceChain/:destChain', networkSelector, IBCTransferController.getTransfersByChains);

// Get transfer by packet ID - Bu genel route'u en sona bırakalım
router.get('/:id', networkSelector, IBCTransferController.getTransferById);

export default router; 