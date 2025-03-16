import { Router } from 'express';
import { BTCDelegationController } from '../../controllers/btc-delegations/BTCDelegationController';
import { networkSelector } from '../../middleware/network-selector';

const router = Router();

// New route (with query parameter)
router.get('/', networkSelector, BTCDelegationController.getDelegationsByStatus);

// Support old route structure (for backward compatibility)
router.get('/status', networkSelector, BTCDelegationController.getDelegationsByStatus);

// Get delegations by staker address
router.get('/staker/:stakerAddress', networkSelector, BTCDelegationController.getDelegationsByStakerAddress);

// get delegation by tx hash
router.get('/tx/:txHash', networkSelector, BTCDelegationController.getDelegationByTxHash);

export default router; 