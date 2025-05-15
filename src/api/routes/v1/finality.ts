import { Router } from 'express';
import { FinalitySignatureService } from '../../../services/finality/FinalitySignatureService';
import { FinalityProviderService } from '../../../services/finality/FinalityProviderService';
import { Network } from '../../../types/finality';
import { v4 as uuidv4 } from 'uuid';
import { FinalityEpochService } from '../../../services/finality/FinalityEpochService';
import { FinalityDelegationService } from '../../../services/finality/FinalityDelegationService';
import { StakeholderRewardsController } from '../../controllers/finality/StakeholderRewardsController';
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

// Get finality providers with optional status filter
router.get('/providers', async (req, res) => {
    try {
        const network = req.network || Network.MAINNET;
        const status = req.query.status as string || 'all';
        const sortBy = req.query.sortBy as string || 'active_tvl'; // Default sorting by active_tvl
        const sortOrder = req.query.sortOrder as string || 'desc'; // Default sort order is descending
        
        // Validate status parameter
        if (status && !['active', 'inactive', 'all'].includes(status.toLowerCase())) {
            return res.status(400).json({
                error: 'Invalid status parameter. Must be one of: active, inactive, all'
            });
        }
        
        // Validate sortBy parameter
        const validSortFields = ['active_tvl', 'total_tvl', 'delegation_count', 'power', 'commission'];
        if (sortBy && !validSortFields.includes(sortBy.toLowerCase())) {
            return res.status(400).json({
                error: `Invalid sortBy parameter. Must be one of: ${validSortFields.join(', ')}`
            });
        }
        
        // Validate sortOrder parameter
        if (sortOrder && !['asc', 'desc'].includes(sortOrder.toLowerCase())) {
            return res.status(400).json({
                error: 'Invalid sortOrder parameter. Must be one of: asc, desc'
            });
        }
        
        let providers;
        
        // Get providers based on status parameter
        if (status.toLowerCase() === 'active') {
            providers = await finalityProviderService.getActiveFinalityProviders(network);
            logger.info(`Retrieved ${providers.length} active finality providers for ${network}`);
        } else if (status.toLowerCase() === 'inactive') {
            // Get all providers first
            const allProviders = await finalityProviderService.getAllFinalityProviders(network);
            // Then get active providers
            const activeProviders = await finalityProviderService.getActiveFinalityProviders(network);
            
            // Create a set of active provider keys for efficient lookup
            const activePkSet = new Set(activeProviders.map(p => p.btc_pk));
            
            // Filter out active providers to get inactive ones
            providers = allProviders.filter(p => !activePkSet.has(p.btc_pk));
            logger.info(`Retrieved ${providers.length} inactive finality providers for ${network}`);
        } else {
            // Default to all providers
            providers = await finalityProviderService.getAllFinalityProviders(network);            
            logger.info(`Retrieved ${providers.length} total finality providers for ${network}`);
        }

        // ALWAYS get the latest active providers from the node
        // Finality providers' active status can change over time
        // We should not rely on the status query parameter for determining actual active status
        const activeProviders = await finalityProviderService.getActiveFinalityProviders(network);
        const activePkSet = new Set(activeProviders.map(p => p.btc_pk));

        // Get all delegation stats in a single query for better performance
        const allDelegationStats = await finalityProviderService.getAllFinalityProviderDelegationStats(network);
        
        // Enhance providers with TVL and delegation count information
        const providersWithStats = providers.map(provider => {
            const delegationStats = allDelegationStats[provider.btc_pk] || {
                active_tvl: "0 BTC",
                active_tvl_sat: 0,
                total_tvl: "0 BTC",
                total_tvl_sat: 0,
                delegation_count: 0
            };
            
            // Add TVL, delegation count and status to provider data
            return {
                ...provider,
                active_tvl: delegationStats.active_tvl,
                active_tvl_sat: delegationStats.active_tvl_sat,
                total_tvl: delegationStats.total_tvl,
                total_tvl_sat: delegationStats.total_tvl_sat,
                delegation_count: delegationStats.delegation_count,
                status: {
                    is_active: activePkSet.has(provider.btc_pk),
                    jailed: provider.jailed || false
                }
            };
        });

        // Sort providers based on the specified field and order
        const sortedProviders = [...providersWithStats].sort((a, b) => {
            let aValue, bValue;
            
            switch(sortBy.toLowerCase()) {
                case 'active_tvl':
                    aValue = a.active_tvl_sat || 0;
                    bValue = b.active_tvl_sat || 0;
                    break;
                case 'total_tvl':
                    aValue = a.total_tvl_sat || 0;
                    bValue = b.total_tvl_sat || 0;
                    break;
                case 'delegation_count':
                    aValue = a.delegation_count || 0;
                    bValue = b.delegation_count || 0;
                    break;
                case 'power':
                    // Provider power can be calculated from voting_power in BabylonClient
                    // But for now we'll use the TVL as a proxy since we don't have direct access
                    aValue = a.active_tvl_sat || 0;
                    bValue = b.active_tvl_sat || 0;
                    break;
                case 'commission':
                    // Commission can be a string with a percentage, parse it
                    aValue = parseFloat(a.commission || '0');
                    bValue = parseFloat(b.commission || '0');
                    break;
                default:
                    aValue = a.active_tvl_sat || 0;
                    bValue = b.active_tvl_sat || 0;
            }
            
            // Apply sort order
            return sortOrder.toLowerCase() === 'asc' 
                ? aValue - bValue 
                : bValue - aValue;
        });

        return res.json({
            providers: sortedProviders,
            count: sortedProviders.length,
            status: status.toLowerCase(),
            sort: {
                by: sortBy.toLowerCase(),
                order: sortOrder.toLowerCase()
            },
            timestamp: Date.now()
        });
    } catch (error) {
        logger.error('Error getting finality providers:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// For backward compatibility - redirect to filtered active providers
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

// Get finality provider details
router.get('/providers/:fpBtcPkHex', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const network = req.network || Network.MAINNET;
        
        // Get the provider details and delegation statistics in parallel
        const [provider, delegationStats] = await Promise.all([
            finalityProviderService.getFinalityProvider(fpBtcPkHex, network),
            finalityProviderService.getFinalityProviderDelegationStats(fpBtcPkHex, network)
        ]);
        
        // Combine provider details with delegation statistics
        const enrichedProvider = {
            ...provider,
            active_tvl: delegationStats.active_tvl,
            active_tvl_sat: delegationStats.active_tvl_sat,
            total_tvl: delegationStats.total_tvl,
            total_tvl_sat: delegationStats.total_tvl_sat,
            delegation_count: delegationStats.delegation_count
        };
        
        return res.json(enrichedProvider);
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

// Initialize the stakeholder rewards controller and register its routes
const stakeholderRewardsController = StakeholderRewardsController.getInstance();
stakeholderRewardsController.registerRoutes(router);

export default router;