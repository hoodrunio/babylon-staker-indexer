import { Router } from 'express';
import { BlockProcessorController } from '../../controllers/blockchain/block-processor.controller';
import { cacheMiddleware } from '../../middleware/cache.middleware';

const router = Router();
const blockProcessorController = new BlockProcessorController();

router.get('/networks', blockProcessorController.getSupportedNetworks);
router.post('/sync', blockProcessorController.startHistoricalSync);
router.get('/tx/:txHash', blockProcessorController.getTxDetails);
router.get('/block/:height', blockProcessorController.getBlockByHeight);
router.get('/block/:height/txs', blockProcessorController.getTxsByHeight);
router.get('/latest-block', blockProcessorController.getLatestBlock);
router.get('/block-by-hash/:hash', blockProcessorController.getBlockByHash);
router.get('/latest-blocks', blockProcessorController.getLatestBlocks);
router.get('/latest-transactions', cacheMiddleware(30), blockProcessorController.getLatestTransactions);

export default router;