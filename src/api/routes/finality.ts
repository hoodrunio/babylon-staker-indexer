import { Router, Request, Response } from 'express';
import { FinalityProviderService } from '../../services/finality/FinalityProviderService';
import { FinalitySignatureService } from '../../services/finality/FinalitySignatureService';
import { formatSatoshis } from '../../utils/util';
import { DelegationResponse } from '../../types/finality/btcstaking';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const finalityProviderService = FinalityProviderService.getInstance();
const finalitySignatureService = FinalitySignatureService.getInstance();

// Get signature stats for a finality provider
router.get('/signatures/:fpBtcPkHex/stats', async (req, res) => {
    try {
        const { fpBtcPkHex } = req.params;
        const { startHeight, endHeight, lastNBlocks } = req.query;

        // Query parametrelerini kontrol et ve dönüştür
        if (lastNBlocks) {
            const lastN = parseInt(lastNBlocks as string, 10);
            if (isNaN(lastN) || lastN <= 0) {
                return res.status(400).json({
                    error: 'lastNBlocks must be a positive number'
                });
            }
            const stats = await finalitySignatureService.getSignatureStats({ 
                fpBtcPkHex, 
                lastNBlocks: lastN 
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
                endHeight: end 
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

export default router; 