import { Router } from 'express';
import { BLSCheckpointController } from '../../controllers/bls-checkpoint.controller';
import { networkSelector } from '../../middleware/network-selector';

const router = Router();

// Get checkpoint data for a specific epoch
router.get('/epoch/:epoch', networkSelector, BLSCheckpointController.getCheckpointByEpoch);

// Get validator signatures for a specific epoch
router.get('/epoch/:epoch/signatures', networkSelector, BLSCheckpointController.getValidatorSignaturesByEpoch);

// Get current epoch statistics
router.get('/current/stats', networkSelector, BLSCheckpointController.getCurrentEpochStats);

// Get validator statistics
router.get('/validator/:valoper_address/stats', networkSelector, BLSCheckpointController.getValidatorStats);

export default router; 