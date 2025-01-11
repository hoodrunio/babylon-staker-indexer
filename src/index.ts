import express from 'express';
import dotenv from 'dotenv';
import router from './api/routes';
import { BabylonIndexer } from './services/BabylonIndexer';
import { FinalitySignatureService } from './services/finality/FinalitySignatureService';

// Load environment variables
dotenv.config();

async function startServer() {
    console.log('Starting signature monitoring service...');
    
    // Initialize and start the FinalitySignatureService
    const finalityService = FinalitySignatureService.getInstance();
    await finalityService.start(); // Yeni metod ekleyeceğiz

    const app = express();
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    const port = process.env.PORT || 3000;

    // Middleware
    app.use(express.json());

    // Routes - Add /api prefix
    app.use('/api', router);

    // Basic route for testing
    app.get('/', (req, res) => {
      res.json({ message: 'Babylon Indexer API' });
    });

    // Error handling
    app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(err.stack);
      res.status(500).json({ error: 'Something broke!' });
    });

    // Start server
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });

    // Initialize indexer
    const indexer = new BabylonIndexer();

    // Start indexing if INDEXER_ENABLED is true
    if (process.env.INDEXER_ENABLED === 'true') {
      const startHeight = parseInt(process.env.START_HEIGHT || '0');
      const endHeight = parseInt(process.env.END_HEIGHT || '0');
      
      if (startHeight && endHeight) {
        indexer.scanBlocks(startHeight, endHeight).catch(console.error);
      }
    } 
}

startServer().catch(console.error); 