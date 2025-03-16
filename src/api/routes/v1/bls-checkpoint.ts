import { Router } from 'express';
import { BLSCheckpointController } from '../../controllers/bls-checkpoint.controller';
import { networkSelector } from '../../middleware/network-selector';

const router = Router();

// Get checkpoint data for a specific epoch
router.get('/epoch/:epoch', networkSelector, BLSCheckpointController.getCheckpointByEpoch);

// Get checkpoint data for a range of epochs
router.get('/epochs', networkSelector, BLSCheckpointController.getCheckpointsByEpochs);

// Get validator signatures for a specific epoch
router.get('/epoch/:epoch/signatures', networkSelector, BLSCheckpointController.getValidatorSignaturesByEpoch);

// Get latest epoch statistics
router.get('/latest/stats', networkSelector, BLSCheckpointController.getLatestEpochStats);

// Get validator statistics
router.get('/validator/:valoper_address/stats', networkSelector, BLSCheckpointController.getValidatorStats);

export default router; 