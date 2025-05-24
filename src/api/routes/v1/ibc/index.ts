import { Router } from 'express';
import transfersRouter from './transfers';
import channelsRouter from './channels';
import packetsRouter from './packets';
import connectionsRouter from './connections';
import clientsRouter from './clients';
import relayersRouter from './relayers';
import analyticsRouter from './analytics.routes';

const router = Router();

// Mount IBC sub-routes
router.use('/transfers', transfersRouter);
router.use('/channels', channelsRouter);
router.use('/packets', packetsRouter);
router.use('/connections', connectionsRouter);
router.use('/clients', clientsRouter);
router.use('/relayers', relayersRouter);
router.use('/analytics', analyticsRouter);

export default router; 