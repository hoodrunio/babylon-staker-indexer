import { Router } from 'express';
import { FinalitySignatureService } from '../../../services/finality/FinalitySignatureService';
import { FinalityProviderService } from '../../../services/finality/FinalityProviderService';
import { Network } from '../../middleware/network-selector';
import { v4 as uuidv4 } from 'uuid';
import { formatSatoshis } from '../../../utils/util';

const router = Router();
const finalitySignatureService = FinalitySignatureService.getInstance();
const finalityProviderService = FinalityProviderService.getInstance();

// Get signature stats for a finality provider
router.get('/signatures/:fpBtcPkHex/stats', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const { startHeight, endHeight, lastNBlocks } = req.query;
        const network = req.network || Network.MAINNET;

        if (lastNBlocks) {
            const lastN = parseInt(lastNBlocks as string, 10);
            if (isNaN(lastN) || lastN <= 0) {
                return res.status(400).json({
                    error: 'lastNBlocks must be a positive number'
                });
            }
            const stats = await finalitySignatureService.getSignatureStats({ 
                fpBtcPkHex, 
                lastNBlocks: lastN,
                network 
            });
            return res.json(stats);
        }

        if (startHeight && endHeight) {
            const start = parseInt(startHeight as string, 10);
            const end = parseInt(endHeight as string, 10);
            
            if (isNaN(start) || isNaN(end)) {
                return res.status(400).json({
                    error: 'startHeight and endHeight must be numbers'
                });
            }
            
            if (start > end) {
                return res.status(400).json({
                    error: 'startHeight must be less than or equal to endHeight'
                });
            }

            const stats = await finalitySignatureService.getSignatureStats({ 
                fpBtcPkHex, 
                startHeight: start, 
                endHeight: end,
                network
            });
            return res.json(stats);
        }

        return res.status(400).json({
            error: 'Either lastNBlocks or both startHeight and endHeight must be provided'
        });
    } catch (error) {
        console.error('Error getting signature stats:', error);
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
        finalitySignatureService.addSSEClient(clientId, res, fpBtcPkHex);

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

export default router; 