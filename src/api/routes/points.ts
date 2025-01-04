import { Router } from 'express';
import { PointsProxyService } from '../../services/PointsProxyService';
import { FinalityProviderService } from '../../database/services/FinalityProviderService';

const router = Router();
const pointsProxyService = PointsProxyService.getInstance();
const finalityProviderService = new FinalityProviderService();

// Get points for all finality providers
router.get('/finality-providers', async (req, res) => {
  try {
    // Get all FP addresses from database
    const totalCount = await finalityProviderService.getFinalityProvidersCount();
    const fps = await finalityProviderService.getAllFPs(0, totalCount);
    const fpAddresses = fps.map(fp => fp.address);

    // Get points for all FPs
    const results = await pointsProxyService.getFinalityProvidersPoints(fpAddresses);
    
    // Format the response
    const response = {
      data: results.filter(r => r.success).map(r => r.data),
      meta: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        errors: results.filter(r => !r.success).map(r => ({
          fpPkHex: r.fpPkHex,
          error: r.error
        }))
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching all finality provider points:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get points for a single finality provider
router.get('/finality-providers/:fpPkHex', async (req, res) => {
  try {
    const { fpPkHex } = req.params;
    const points = await pointsProxyService.getFinalityProviderPoints(fpPkHex);
    
    if (!points) {
      return res.status(404).json({ 
        error: 'Points not found',
        message: 'No points data available for this finality provider'
      });
    }

    res.json({ data: points });
  } catch (error) {
    console.error('Error fetching finality provider points:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get points for multiple finality providers (batch request)
router.post('/finality-providers/batch', async (req, res) => {
  try {
    const { finality_provider_pks } = req.body;

    if (!Array.isArray(finality_provider_pks)) {
      return res.status(400).json({ error: 'finality_provider_pks must be an array' });
    }

    if (finality_provider_pks.length === 0) {
      return res.status(400).json({ error: 'finality_provider_pks array cannot be empty' });
    }

    const results = await pointsProxyService.getFinalityProvidersPoints(finality_provider_pks);
    
    // Format the response
    const response = {
      data: results.filter(r => r.success).map(r => r.data),
      meta: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        errors: results.filter(r => !r.success).map(r => ({
          fpPkHex: r.fpPkHex,
          error: r.error
        }))
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching batch finality provider points:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 