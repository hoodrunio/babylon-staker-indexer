import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { BabylonIndexer } from '../../services/BabylonIndexer';
import { swaggerDocument } from '../swagger';
import { 
  compressionMiddleware, 
  rateLimiter, 
  paginationMiddleware, 
  formatPaginatedResponse,
  corsMiddleware 
} from '../middleware';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();
const indexer = new BabylonIndexer();

// Apply global middlewares
router.use(corsMiddleware);
router.use(compressionMiddleware);
router.use(rateLimiter);

// Swagger documentation route
router.use('/api-docs', corsMiddleware, swaggerUi.serve);
router.get('/api-docs', corsMiddleware, swaggerUi.setup(swaggerDocument, {
  swaggerOptions: {
    url: `${process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGINS : 'http://localhost:3000'}/api/api-docs`,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth: 1
  }
}));

// Add route to serve swagger.json
router.get('/swagger.json', corsMiddleware, (req, res) => {
  res.json(swaggerDocument);
});

// Finality Provider routes
router.get('/finality-providers', paginationMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = 'totalStake', order = 'desc', skip = 0 } = req.pagination!;
    const includeStakers = req.query.include_stakers === 'true';
    const stakersLimit = parseInt(req.query.stakers_limit as string) || 50;
    const stakersPage = parseInt(req.query.stakers_page as string) || 1;
    
    const [fps, total] = await Promise.all([
      indexer.getAllFinalityProviders(
        skip, 
        limit, 
        sortBy, 
        order, 
        includeStakers,
        (stakersPage - 1) * stakersLimit,
        stakersLimit
      ),
      indexer.getFinalityProvidersCount()
    ]);

    res.json({ 
      data: fps,
      timestamp: Date.now(),
      meta: {
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          totalCount: total,
          hasMore: page < Math.ceil(total / limit)
        },
        stakers: includeStakers ? {
          page: stakersPage,
          limit: stakersLimit
        } : null
      }
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/finality-providers/top', paginationMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = 'totalStake', order = 'desc', skip = 0 } = req.pagination!;
    const includeStakers = req.query.include_stakers === 'true';
    
    const [fps, total] = await Promise.all([
      indexer.getTopFinalityProviders(skip, limit, sortBy, order, includeStakers),
      indexer.getFinalityProvidersCount()
    ]);

    res.json(formatPaginatedResponse(fps, total, page, limit));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/finality-providers/:address', async (req, res) => {
  const { address } = req.params;
  const { from, to } = req.query;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  
  try {
    const timeRange = from && to ? {
      firstTimestamp: Number(from),
      lastTimestamp: Number(to),
      durationSeconds: Number(to) - Number(from),
    } : undefined;

    const skip = (page - 1) * limit;

    const [stats, totalCount] = await Promise.all([
      indexer.getFinalityProviderStats(address, timeRange, skip, limit),
      indexer.getFinalityProviderTotalStakers(address, timeRange)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({ 
      data: stats,
      timestamp: Date.now(),
      meta: {
        pagination: {
          page,
          limit,
          totalPages,
          totalCount,
          hasMore: page < totalPages
        },
        timeRange: timeRange ? {
          from: timeRange.firstTimestamp,
          to: timeRange.lastTimestamp,
          duration: timeRange.durationSeconds
        } : null
      }
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Staker routes
router.get('/stakers', paginationMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = 'totalStake', order = 'desc', skip = 0 } = req.pagination!;
    const includeTransactions = req.query.include_transactions === 'true';
    
    const [stakers, total] = await Promise.all([
      indexer.getTopStakers(skip, limit, sortBy, order, includeTransactions),
      indexer.getStakersCount()
    ]);

    res.json(formatPaginatedResponse(stakers, total, page, limit));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/stakers/:address', async (req, res) => {
  const { address } = req.params;
  const { from, to } = req.query;
  const includeTransactions = req.query.include_transactions === 'true';
  
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

    const stats = await indexer.getStakerStats(address, timeRange, includeTransactions);
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