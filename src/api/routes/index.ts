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
import { Router } from 'express';
import pointsRouter from './points';
import { FinalityProviderService } from '../../database/services/FinalityProviderService';

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
  const { from, to, search, sort_by = 'stake', sort_order = 'desc' } = req.query;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  
  try {
    const timeRange = from && to ? {
      firstTimestamp: Number(from),
      lastTimestamp: Number(to),
      durationSeconds: Number(to) - Number(from),
    } : undefined;

    const skip = (page - 1) * limit;

    // Validate sort_order
    if (sort_order && !['asc', 'desc'].includes(sort_order as string)) {
      throw new Error('Invalid sort_order. Must be either "asc" or "desc".');
    }

    // Validate sort_by
    const allowedSortFields = ['stake', 'address', 'timestamp', 'txId'];
    if (sort_by && !allowedSortFields.includes(sort_by as string)) {
      throw new Error(`Invalid sort_by. Must be one of: ${allowedSortFields.join(', ')}`);
    }

    const [stats, totalCount] = await Promise.all([
      indexer.getFinalityProviderStats(
        address, 
        timeRange, 
        skip, 
        limit,
        search as string,
        sort_by as string,
        sort_order as 'asc' | 'desc'
      ),
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

router.get('/finality-providers/:address/grouped-stakers', paginationMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = 'totalStake', order = 'desc' } = req.pagination!;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;
    const address = req.params.address;

    // Validate sort_by
    const allowedSortFields = ['totalStake', 'lastStakedAt'];
    if (sortBy && !allowedSortFields.includes(sortBy)) {
      throw new Error(`Invalid sortBy. Must be one of: ${allowedSortFields.join(', ')}`);
    }

    const fpService = new FinalityProviderService();
    const result = await fpService.getGroupedStakers(
      address, 
      skip, 
      limit, 
      order as 'asc' | 'desc',
      sortBy,
      search
    );

    return res.json({
      data: result.stakers,
      metadata: {
        currentPage: page,
        totalPages: Math.ceil(result.total / limit),
        totalItems: result.total,
        itemsPerPage: limit
      },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching grouped stakers:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Staker routes
router.get('/stakers', paginationMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, sortBy = 'totalStake', order = 'desc', skip = 0 } = req.pagination!;
    const includeTransactions = req.query.include_transactions === 'true';
    const transactionsLimit = parseInt(req.query.transactions_limit as string) || 50;
    const transactionsPage = parseInt(req.query.transactions_page as string) || 1;
    
    const [stakers, total, globalStats] = await Promise.all([
      indexer.getTopStakers(
        skip, 
        limit, 
        sortBy, 
        order, 
        includeTransactions,
        (transactionsPage - 1) * transactionsLimit,
        transactionsLimit
      ),
      indexer.getStakersCount(),
      indexer.getStakerGlobalStats()
    ]);

    res.json({ 
      data: stakers,
      timestamp: Date.now(),
      meta: {
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          totalCount: total,
          hasMore: page < Math.ceil(total / limit)
        },
        transactions: includeTransactions ? {
          page: transactionsPage,
          limit: transactionsLimit
        } : null
      },
      globalStats
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/stakers/:address', async (req, res) => {
  const { address } = req.params;
  const { from, to } = req.query;
  const includeTransactions = req.query.include_transactions === 'true';
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const sortBy = (req.query.sort_by as string) || 'timestamp';
  const sortOrder = (req.query.sort_order as string || 'desc') as 'asc' | 'desc';
  
  try {
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

    // Validate sort_order
    if (sortOrder && !['asc', 'desc'].includes(sortOrder)) {
      throw new Error('Invalid sort_order. Must be either "asc" or "desc".');
    }

    // Validate sort_by
    const allowedSortFields = ['timestamp', 'totalStake'];
    if (sortBy && !allowedSortFields.includes(sortBy)) {
      throw new Error(`Invalid sort_by. Must be one of: ${allowedSortFields.join(', ')}`);
    }

    const skip = (page - 1) * limit;

    const [stats, totalTransactions] = await Promise.all([
      indexer.getStakerStats(
        address, 
        timeRange, 
        includeTransactions,
        skip,
        limit,
        sortBy,
        sortOrder
      ),
      indexer.getStakerTotalTransactions(address, timeRange)
    ]);

    const totalPages = Math.ceil(totalTransactions / limit);

    res.json({ 
      data: stats,
      timestamp: Date.now(),
      meta: {
        pagination: includeTransactions ? {
          page,
          limit,
          totalPages,
          totalCount: totalTransactions,
          hasMore: page < totalPages
        } : null,
        timeRange: timeRange ? {
          from: timeRange.firstTimestamp,
          to: timeRange.lastTimestamp,
          duration: timeRange.durationSeconds
        } : null,
        sorting: {
          sortBy,
          sortOrder
        }
      }
    });
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

// Points proxy routes
router.use('/points', pointsRouter);

export default router; 