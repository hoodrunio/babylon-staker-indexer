import { Router } from 'express';
import { IBCAnalyticsController } from '../../../controllers/ibc/ibc-analytics.controller';

const router = Router();

/**
 * IBC Analytics Routes
 * 
 * Provides endpoints for comprehensive IBC analytics data:
 * - Channels: Active channels, volumes, status
 * - Connected Chains: Chain details, volumes per token
 * - Transactions: Total counts, latest transactions
 * - Relayers: Addresses by chain, volumes, transaction counts
 */

// GET /api/v1/ibc/analytics/overview - Complete analytics overview
router.get('/overview', IBCAnalyticsController.getOverallAnalytics);

// GET /api/v1/ibc/analytics/summary - High-level summary for dashboard
router.get('/summary', IBCAnalyticsController.getSummary);

// GET /api/v1/ibc/analytics/channels - Channel analytics
router.get('/channels', IBCAnalyticsController.getChannelAnalytics);

// GET /api/v1/ibc/analytics/chains - Connected chains analytics
router.get('/chains', IBCAnalyticsController.getChainAnalytics);

// GET /api/v1/ibc/analytics/transactions - Transaction analytics
router.get('/transactions', IBCAnalyticsController.getTransactionAnalytics);

// GET /api/v1/ibc/analytics/relayers - Relayer analytics
router.get('/relayers', IBCAnalyticsController.getRelayerAnalytics);

export default router; 