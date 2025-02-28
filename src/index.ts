import express from 'express';
import dotenv from 'dotenv';
import router from './api/routes';
import { BabylonIndexer } from './services/BabylonIndexer';
import { FinalitySignatureService } from './services/finality/FinalitySignatureService';
import { WebsocketService } from './services/WebsocketService';
import { BTCDelegationService } from './services/btc-delegations/BTCDelegationService';
import { BBNIndexerManager } from './services/BBNIndexerManager';
import cors from 'cors';
import { logger } from './utils/logger';
import { GovernanceIndexerService } from './services/governance/GovernanceIndexerService';
import { BabylonClient } from './clients/BabylonClient';

// Load environment variables
dotenv.config();

async function startServer() {
    logger.info('Starting services...');

    // Initialize and start the FinalitySignatureService
    const finalityService = FinalitySignatureService.getInstance();
    await finalityService.start();

    // Initialize BTCDelegationService (this will start initial sync)
    logger.info('Initializing BTCDelegationService...');
    BTCDelegationService.getInstance();

    // Initialize BBN Indexers
    logger.info('Initializing BBN Indexers...');
    const bbnIndexerManager = BBNIndexerManager.getInstance();
    bbnIndexerManager.start().catch(err => {
        logger.error('Failed to start BBN Indexer Manager:', err);
    });

    const app = express();
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    const port = process.env.PORT || 3000;

    // Initialize and start the WebSocket service
    const websocketService = WebsocketService.getInstance();
    websocketService.startListening();

    // CORS settings
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        maxAge: 86400
    }));

    // Middleware
    app.use(express.json());

    // Special CORS middleware for SSE endpoints
    app.use('/api/finality/signatures/:fpBtcPkHex/stream', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        next();
    });

    // Routes - Add /api prefix
    app.use('/api', router);

    // Basic route for testing
    app.get('/', (req, res) => {
        res.json({ message: 'Babylon Indexer API' });
    });

    // Error handling
    app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
        logger.error(err.stack);
        res.status(500).json({ error: 'Something broke!' });
    });

    // Start server
    app.listen(port, () => {
        logger.info(`Server running at http://localhost:${port}`);
    });

    // Initialize indexer
    const indexer = new BabylonIndexer();

    // Start indexing if INDEXER_ENABLED is true
    if (process.env.INDEXER_ENABLED === 'true') {
        const startHeight = parseInt(process.env.START_HEIGHT || '0');
        const endHeight = parseInt(process.env.END_HEIGHT || '0');

        if (startHeight && endHeight) {
            indexer.scanBlocks(startHeight, endHeight).catch(logger.error);
        }
    }

    // Initialize Babylon client
    const babylonClient = BabylonClient.getInstance();

    // Initialize governance indexer
    const governanceIndexer = new GovernanceIndexerService(babylonClient);
    governanceIndexer.start();

    // Special shutdown process for PM2
    const shutdown = async (signal: string) => {
        logger.info(`${signal} signal received. Starting graceful shutdown...`);
        try {
            // Stop all services
            websocketService.stop();
            finalityService.stop();
            bbnIndexerManager.stop();

            // Wait a bit for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));

            logger.info('All services stopped. Waiting for final cleanup...');

            // Allow PM2 to use its own logging mechanism
            if (process.env.PM2_USAGE) {
                // Allow PM2 to use its own logging mechanism
                process.send?.('shutdown');
                // Wait a little longer
                await new Promise(resolve => setTimeout(resolve, 1500));
            } else {
                // Close Winston logger if running outside PM2
                await new Promise<void>((resolve) => {
                    logger.on('finish', resolve);
                    logger.end();
                });
            }

            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown:', error);
            process.exit(1);
        }
    };

    // Listen for PM2 shutdown message
    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            shutdown('PM2');
        }
    });

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch(logger.error);