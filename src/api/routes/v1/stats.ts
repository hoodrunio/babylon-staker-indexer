import { Router } from 'express';
import { StatsController } from '../../controllers/stats.controller';
import { networkSelector } from '../../middleware/network-selector';

const router = Router();

// Get overall stats
router.get('/', networkSelector, StatsController.getStats);

export default router;
