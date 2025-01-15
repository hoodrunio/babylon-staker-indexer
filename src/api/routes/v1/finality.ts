import { Router } from 'express';
import { FinalitySignatureService } from '../../../services/finality/FinalitySignatureService';
import { FinalityProviderService } from '../../../services/finality/FinalityProviderService';
import { Network } from '../../middleware/network-selector';
import { v4 as uuidv4 } from 'uuid';
import { FinalityEpochService } from '../../../services/finality/FinalityEpochService';
import { FinalitySSEManager } from '../../../services/finality/FinalitySSEManager';
import { SignatureStatsParams } from '../../../types/finality';

const router = Router();
const finalitySignatureService = FinalitySignatureService.getInstance();
const finalityProviderService = FinalityProviderService.getInstance();
const finalityEpochService = FinalityEpochService.getInstance();
const finalitySSEManager = FinalitySSEManager.getInstance();
// Get signature stats for a finality provider
router.get('/signatures/:fpBtcPkHex/stats', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const network = req.network || Network.MAINNET;
        const DEFAULT_BLOCKS = 100; // Son 100 blok için istatistikler

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
        console.error('Error getting signature stats:', error);
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
        const lookbackBlocks = 5000; // Son 5000 blok

        // Son 5000 bloğun istatistiklerini al
        const startHeight = Math.max(1, currentHeight - lookbackBlocks + 1);
        const stats = await finalitySignatureService.getSignatureStats({ 
            fpBtcPkHex, 
            startHeight: startHeight,
            endHeight: currentHeight,
            network
        });

        // Performans metriklerini hesapla
        const totalBlocks = currentHeight - startHeight + 1; // Gerçek toplam blok sayısı
        const signableBlocks = stats.signedBlocks + stats.missedBlocks; // İmzalanabilir bloklar
        const successRate = signableBlocks > 0 ? (stats.signedBlocks / signableBlocks) * 100 : 0;

        // Bilinmeyen blokları hesapla
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
        console.error('Error getting performance stats:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// SSE endpoint for real-time signature updates
router.get('/signatures/:fpBtcPkHex/stream', (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const network = req.network || Network.MAINNET;
        const clientId = uuidv4();

        console.log(`[SSE] New client connected: ${clientId} for FP: ${fpBtcPkHex}`);

        // SSE bağlantısını başlat
        finalitySSEManager.addClient(
            clientId, 
            res, 
            fpBtcPkHex, 
            finalitySignatureService.getSignatureStats.bind(finalitySignatureService)
        );

        // Client bağlantısı kapandığında cleanup yap
        req.on('close', () => {
            console.log(`[SSE] Client connection closed: ${clientId}`);
        });
    } catch (error) {
        console.error('[SSE] Error setting up SSE connection:', error);
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
        console.error('Error getting active finality providers:', error);
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
        console.error('Error getting all finality providers:', error);
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
        console.error('Error getting finality provider:', error);
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
        console.error('Error getting finality provider power:', error);
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
        const { page = '1', limit = '10' } = req.query;
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

        const result = await finalityProviderService.getFinalityProviderDelegations(
            fpBtcPkHex, 
            network,
            pageNum,
            limitNum
        );
        
        return res.json({
            delegations: result.delegations,
            metadata: {
                count: result.delegations.length,
                total_amount: result.total_amount,
                total_amount_sat: result.total_amount_sat,
                timestamp: Date.now(),
                pagination: result.pagination
            }
        });
    } catch (error) {
        console.error('Error getting finality provider delegations:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get current epoch statistics
router.get('/epoch/current/stats', async (req, res) => {
    try {
        const network = req.network || Network.MAINNET;
        const stats = await finalityEpochService.getCurrentEpochStats(network);
        return res.json(stats);
    } catch (error) {
        console.error('Error getting current epoch stats:', error);
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
        const stats = await finalityEpochService.getProviderCurrentEpochStats(fpBtcPkHex, finalitySignatureService.getSignatureStats, network);
        return res.json(stats);
    } catch (error) {
        console.error('Error getting current epoch stats for provider:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router; 