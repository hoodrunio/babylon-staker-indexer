import { Router } from 'express';
import { FinalitySignatureService } from '../../services/finality/FinalitySignatureService';

const router = Router();
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

export default router; 