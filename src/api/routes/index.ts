import express from 'express';
import { BabylonIndexer } from '../../services/BabylonIndexer';

const router = express.Router();
const indexer = new BabylonIndexer();

// Finality Provider routes
router.get('/finality-providers', async (req, res) => {
  try {
    const fps = await indexer.getAllFinalityProviders();
    res.json({ 
      data: fps,
      count: fps.length,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/finality-providers/top', async (req, res) => {
  const { limit } = req.query;
  
  try {
    const fps = await indexer.getTopFinalityProviders(Number(limit) || 10);
    res.json({ 
      data: fps,
      count: fps.length,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/finality-providers/:address', async (req, res) => {
  const { address } = req.params;
  const { from, to } = req.query;
  
  try {
    const timeRange = from && to ? {
      firstTimestamp: Number(from),
      lastTimestamp: Number(to),
      durationSeconds: Number(to) - Number(from),
    } : undefined;

    const stats = await indexer.getFinalityProviderStats(address, timeRange);
    res.json({ 
      data: stats,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Staker routes
router.get('/stakers', async (req, res) => {
  const { limit, from, to } = req.query;
  const timeRange = from && to ? { firstTimestamp: Number(from), lastTimestamp: Number(to) } : undefined;
  
  try {
    const stakers = await indexer.getTopStakers(Number(limit) || 10);
    res.json({ data: stakers });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/stakers/:address', async (req, res) => {
  const { address } = req.params;
  const { from, to } = req.query;
  
  try {
    // Debug search first
    await indexer.db.debugStakerSearch(address);

    // TimeRange parametrelerini kontrol et
    const timeRange = from && to ? {
      firstTimestamp: parseInt(from as string),
      lastTimestamp: parseInt(to as string),
      durationSeconds: parseInt(to as string) - parseInt(from as string)
    } : undefined;

    // TimeRange değerlerinin geçerli olduğunu kontrol et
    if (timeRange) {
      if (isNaN(timeRange.firstTimestamp) || isNaN(timeRange.lastTimestamp)) {
        throw new Error('Invalid time range parameters. Please provide valid timestamps.');
      }
      if (timeRange.firstTimestamp > timeRange.lastTimestamp) {
        throw new Error('Start time must be before end time.');
      }
    }

    const stats = await indexer.getStakerStats(address, timeRange);
    res.json({ data: stats });
  } catch (error) {
    console.error('Staker lookup error:', error);
    res.status(404).json({ 
      error: (error as Error).message,
      details: 'If you believe this is an error, please check the address format and time range parameters.'
    });
  }
});

// Version stats
router.get('/versions/:version', async (req, res) => {
  const { version } = req.params;
  const { from, to } = req.query;
  
  try {
    const stats = await indexer.getVersionStats(Number(version), {
      firstTimestamp: Number(from),
      lastTimestamp: Number(to),
      durationSeconds: Number(to) - Number(from),
    });
    res.json({ data: stats });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Global stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await indexer.getGlobalStats();
    res.json({ data: stats });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Phase stats routes
router.get('/phases', async (req, res) => {
  try {
    const stats = await indexer.db.getAllPhaseStats();
    res.json({ data: stats });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/phases/:phase', async (req, res) => {
  const { phase } = req.params;
  
  try {
    const stats = await indexer.db.getPhaseStats(Number(phase));
    if (!stats) {
      res.status(404).json({ error: `Phase ${phase} not found` });
      return;
    }
    res.json({ data: stats });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Add route for API documentation
router.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Babylon Indexer API</title></head>
      <body>
        <h1>Available Endpoints</h1>
        <ul>
          <li>GET /api/finality-providers</li>
          <li>GET /api/finality-providers/:address</li>
          <li>GET /api/stakers</li>
          <li>GET /api/stakers/:address</li>
          <li>GET /api/versions/:version</li>
          <li>GET /api/stats</li>
          <li>GET /api/phases</li>
          <li>GET /api/phases/:phase</li>
        </ul>
      </body>
    </html>
  `);
});

export default router; 