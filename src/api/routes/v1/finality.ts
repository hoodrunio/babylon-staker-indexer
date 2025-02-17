import { Router } from 'express';
import { FinalitySignatureService } from '../../../services/finality/FinalitySignatureService';
import { FinalityProviderService } from '../../../services/finality/FinalityProviderService';
import { Network } from '../../../types/finality';
import { v4 as uuidv4 } from 'uuid';
import { FinalityEpochService } from '../../../services/finality/FinalityEpochService';
import { FinalityDelegationService } from '../../../services/finality/FinalityDelegationService';
import { BTCDelegationStatus } from '../../../types/finality/btcstaking';
import { SortField, SortOrder } from '../../../services/finality/FinalityDelegationService';
import { logger } from '../../../utils/logger';

const router = Router();
const finalitySignatureService = FinalitySignatureService.getInstance();
const finalityProviderService = FinalityProviderService.getInstance();
const finalityEpochService = FinalityEpochService.getInstance();
// Get signature stats for a finality provider
router.get('/signatures/:fpBtcPkHex/stats', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const network = req.network || Network.MAINNET;
        const DEFAULT_BLOCKS = 100; // Statistics for last 100 blocks

        const currentHeight = await finalitySignatureService.getCurrentHeight();
        const startHeight = Math.max(1, currentHeight - DEFAULT_BLOCKS);
        
        const stats = await finalitySignatureService.getSignatureStats({ 
            fpBtcPkHex, 
            startHeight,
            endHeight: currentHeight,
            network
        });

        return res.json(stats);
    } catch (error) {
        logger.error('Error getting signature stats:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get historical performance stats for a finality provider
router.get('/signatures/:fpBtcPkHex/performance', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const network = req.network || Network.MAINNET;
        const currentHeight = await finalitySignatureService.getCurrentHeight();
        const lookbackBlocks = 5000; // Last 5000 blocks

        // Get statistics for the last 5000 blocks
        const startHeight = Math.max(1, currentHeight - lookbackBlocks + 1);
        const stats = await finalitySignatureService.getSignatureStats({ 
            fpBtcPkHex, 
            startHeight: startHeight,
            endHeight: currentHeight,
            network
        });

        // Calculate performance metrics
        const totalBlocks = currentHeight - startHeight + 1; // Actual total block count
        const signableBlocks = stats.signedBlocks + stats.missedBlocks; // Signable blocks
        const successRate = signableBlocks > 0 ? (stats.signedBlocks / signableBlocks) * 100 : 0;

        // Calculate unknown blocks
        const unknownBlocks = totalBlocks - signableBlocks;

        return res.json({
            overall_performance: {
                signed: `${stats.signedBlocks} / ${signableBlocks}`,
                missed: stats.missedBlocks,
                success_rate: `${successRate.toFixed(2)}`,
                block_range: `${startHeight} - ${currentHeight}`,
                total_blocks: totalBlocks,
                signable_blocks: signableBlocks,
                unknown_blocks: unknownBlocks,
                lookback_blocks: lookbackBlocks
            },
            details: {
                signed_blocks: stats.signedBlocks,
                missed_blocks: stats.missedBlocks,
                unknown_blocks: unknownBlocks,
                total_blocks: totalBlocks,
                signable_blocks: signableBlocks,
                valid_blocks: signableBlocks,
                success_rate: successRate,
                start_height: startHeight,
                end_height: currentHeight,
                lookback_blocks: lookbackBlocks,
                timestamp: Date.now()
            }
        });
    } catch (error) {
        logger.error('Error getting performance stats:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// SSE endpoint for real-time signature updates
router.get('/signatures/:fpBtcPkHex/stream', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const network = req.network || Network.MAINNET;
        const clientId = uuidv4();

        logger.info(`[SSE] New client connected: ${clientId} for FP: ${fpBtcPkHex}`);

        // Start SSE connection
        await finalitySignatureService.addSSEClient(
            clientId, 
            res, 
            fpBtcPkHex
        );

        // Clean up when client connection is closed
        req.on('close', () => {
            logger.info(`[SSE] Client connection closed: ${clientId}`);
        });
    } catch (error) {
        logger.error('[SSE] Error setting up SSE connection:', error);
        res.status(500).end();
    }
});

// Get active finality providers
router.get('/providers/active', async (req, res) => {
    try {
        const network = req.network || Network.MAINNET;
        const providers = await finalityProviderService.getActiveFinalityProviders(network);
        return res.json({
            providers,
            count: providers.length,
            timestamp: Date.now()
        });
    } catch (error) {
        logger.error('Error getting active finality providers:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get all finality providers
router.get('/providers', async (req, res) => {
    try {
        const network = req.network || Network.MAINNET;
        const providers = await finalityProviderService.getAllFinalityProviders(network);
        return res.json({
            providers,
            count: providers.length,
            timestamp: Date.now()
        });
    } catch (error) {
        logger.error('Error getting all finality providers:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get finality provider details
router.get('/providers/:fpBtcPkHex', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const network = req.network || Network.MAINNET;
        const provider = await finalityProviderService.getFinalityProvider(fpBtcPkHex, network);
        return res.json(provider);
    } catch (error) {
        logger.error('Error getting finality provider:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get finality provider power
router.get('/providers/:fpBtcPkHex/power', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const network = req.network || Network.MAINNET;
        const power = await finalityProviderService.getFinalityProviderPower(fpBtcPkHex, network);
        return res.json(power);
    } catch (error) {
        logger.error('Error getting finality provider power:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get finality provider delegations
router.get('/providers/:fpBtcPkHex/delegations', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const { 
            page = '1', 
            limit = '10',
            status,
            sortBy,
            sortOrder = 'desc',
            minAmount,
            maxAmount
        } = req.query;
        const network = req.network || Network.MAINNET;

        // Parse pagination parameters
        const pageNum = parseInt(page as string, 10);
        const limitNum = parseInt(limit as string, 10);

        // Validate pagination parameters
        if (isNaN(pageNum) || pageNum < 1) {
            return res.status(400).json({
                error: 'Invalid page parameter. Must be a positive number'
            });
        }

        if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
            return res.status(400).json({
                error: 'Invalid limit parameter. Must be between 1 and 100'
            });
        }

        // Validate status if provided
        if (status && !Object.values(BTCDelegationStatus).includes(status as BTCDelegationStatus)) {
            return res.status(400).json({
                error: `Invalid status. Must be one of: ${Object.values(BTCDelegationStatus).join(', ')}`
            });
        }

        // Validate sort parameters
        const validSortFields = ['amount', 'startHeight', 'createdAt'];
        if (sortBy && !validSortFields.includes(sortBy as string)) {
            return res.status(400).json({
                error: `Invalid sortBy parameter. Must be one of: ${validSortFields.join(', ')}`
            });
        }

        if (sortOrder && !['asc', 'desc'].includes(sortOrder as string)) {
            return res.status(400).json({
                error: 'Invalid sortOrder parameter. Must be either "asc" or "desc"'
            });
        }

        // Parse amount parameters
        const minAmountNum = minAmount ? parseInt(minAmount as string, 10) : undefined;
        const maxAmountNum = maxAmount ? parseInt(maxAmount as string, 10) : undefined;

        if (minAmountNum && isNaN(minAmountNum)) {
            return res.status(400).json({
                error: 'Invalid minAmount parameter. Must be a number'
            });
        }

        if (maxAmountNum && isNaN(maxAmountNum)) {
            return res.status(400).json({
                error: 'Invalid maxAmount parameter. Must be a number'
            });
        }

        const finalityDelegationService = FinalityDelegationService.getInstance();
        const result = await finalityDelegationService.getFinalityProviderDelegations(
            fpBtcPkHex, 
            network,
            pageNum,
            limitNum,
            {
                status: status as BTCDelegationStatus,
                sortBy: sortBy as SortField,
                sortOrder: sortOrder as SortOrder,
                minAmount: minAmountNum,
                maxAmount: maxAmountNum
            }
        );

        res.json(result);
    } catch (error) {
        logger.error('Error fetching finality provider delegations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current epoch statistics
router.get('/epoch/current/stats', async (req, res) => {
    try {
        const network = req.network || Network.MAINNET;
        const stats = await finalityEpochService.getCurrentEpochStats(network);
        return res.json(stats);
    } catch (error) {
        logger.error('Error getting current epoch stats:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get current epoch statistics for a specific provider
router.get('/epoch/current/stats/:fpBtcPkHex', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const network = req.network || Network.MAINNET;
        const stats = await finalityEpochService.getProviderCurrentEpochStats(
            fpBtcPkHex, 
            finalitySignatureService.getSignatureStats.bind(finalitySignatureService), 
            network
        );
        return res.json(stats);
    } catch (error) {
        logger.error('Error getting current epoch stats for provider:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;