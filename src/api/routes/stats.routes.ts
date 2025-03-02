import { Router } from 'express';
import { getNetworkStats } from '../controllers/stats.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// Stats routes
router.get('/', asyncHandler(getNetworkStats));

export default router; 