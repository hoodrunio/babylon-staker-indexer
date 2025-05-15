import express from 'express';
import dotenv from 'dotenv';
import router from './api/routes';
import { BabylonIndexer } from './services/BabylonIndexer';
import { FinalitySignatureService } from './services/finality/FinalitySignatureService';
import { WebsocketService } from './services/WebsocketService';
import { BTCDelegationService } from './services/btc-delegations/BTCDelegationService';
import { BTCTransactionCrawlerService } from './services/btc-delegations/BTCTransactionCrawlerService';
import cors from 'cors';
import compression from 'compression';
import { logger } from './utils/logger';
import { GovernanceIndexerService } from './services/governance/GovernanceIndexerService';
import { BabylonClient } from './clients/BabylonClient';
import { BlockProcessorModule } from './services/block-processor/BlockProcessorModule';
import { Network } from './types/finality';
import { StatsController } from './api/controllers/stats.controller';
import { CosmWasmScheduler } from './services/cosmwasm/scheduler.service';
import { errorHandler } from './api/errorHandlers';

// Load environment variables
dotenv.config();

async function startServer() {
    logger.info('Starting services...');

    const app = express();
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    const port = process.env.PORT || 3000;

    // CORS settings
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        maxAge: 86400
    }));

    // Compression middleware - Compresses HTTP responses
    app.use(compression());

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
    app.use(errorHandler);

    // Start server
    app.listen(port, () => {
        logger.info(`Server running at http://localhost:${port}`);
    });

    // Initialize and start the FinalitySignatureService
    const finalityService = FinalitySignatureService.getInstance();
    await finalityService.start();

    // Initialize BTCDelegationService (this will start initial sync)
    logger.info('Initializing BTCDelegationService...');
    BTCDelegationService.getInstance();
    
    // Initialize BTCTransactionCrawlerService (this will start periodic crawling)
    if (process.env.BTC_TX_CRAWLER_ENABLED !== 'false') {
        logger.info('Initializing BTCTransactionCrawlerService...');
        BTCTransactionCrawlerService.getInstance();
        logger.info('BTCTransactionCrawlerService initialized and started successfully');
    } else {
        logger.info('BTCTransactionCrawlerService is disabled by configuration');
    }
    
    // Initialize BlockProcessorModule
    logger.info('Initializing BlockProcessorModule...');
    const blockProcessorModule = BlockProcessorModule.getInstance();
    blockProcessorModule.initialize();
    
    // Initialize StatsController to start background cache refresh
    logger.info('Initializing StatsController with background cache refresh...');
    StatsController.initialize();
    
    // Start historical sync if BLOCK_SYNC_ENABLED is true
    if (process.env.BLOCK_SYNC_ENABLED === 'true') {
        const network = process.env.NETWORK === 'mainnet' ? Network.MAINNET : Network.TESTNET;
        const fromHeight = parseInt(process.env.BLOCK_SYNC_FROM_HEIGHT || '0');
        const blockCount = parseInt(process.env.BLOCK_SYNC_COUNT || '100');
        
        if (fromHeight > 0) {
            logger.info(`Starting historical block sync from height ${fromHeight}...`);
            blockProcessorModule.startHistoricalSync(network, fromHeight).catch(logger.error);
        } else {
            logger.info(`Starting latest ${blockCount} blocks sync...`);
            blockProcessorModule.startHistoricalSync(network, undefined, blockCount).catch(logger.error);
        }
    }

    // Initialize and start the WebSocket service
    const websocketService = WebsocketService.getInstance();
    websocketService.startListening();

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

    // Initialize and start CosmWasm indexer if enabled
    if (process.env.COSMWASM_INDEXER_ENABLED === 'true') {
        logger.info('Initializing CosmWasm indexer...');
        // Use the singleton pattern to get the CosmWasm scheduler
        const cosmWasmScheduler = CosmWasmScheduler.getInstance();
        
        cosmWasmScheduler.start();
        logger.info('CosmWasm indexer started successfully');
    }

    // Special shutdown process for PM2
    const shutdown = async (signal: string) => {
        logger.info(`${signal} signal received. Starting graceful shutdown...`);
        try {
            // Stop all services
            websocketService.stop();
            finalityService.stop();

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