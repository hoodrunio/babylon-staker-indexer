import { Router } from 'express';
import { IBCTransferController } from '../../../controllers/ibc/ibc-transfer.controller';
import { networkSelector } from '../../../middleware/network-selector';

const router = Router();

// Get transfer by packet ID
router.get('/:id', networkSelector, IBCTransferController.getTransferById);

// Get transfer by transaction hash
router.get('/tx/:txHash', networkSelector, IBCTransferController.getTransferByTxHash);

// Get transfers by sender address
router.get('/sender/:address', networkSelector, IBCTransferController.getTransfersBySender);

// Get transfers by receiver address
router.get('/receiver/:address', networkSelector, IBCTransferController.getTransfersByReceiver);

// Get transfers between specific chains
router.get('/chains/:sourceChain/:destChain', networkSelector, IBCTransferController.getTransfersByChains);

// Get transfer statistics
router.get('/stats', networkSelector, IBCTransferController.getTransferStats);

export default router; 