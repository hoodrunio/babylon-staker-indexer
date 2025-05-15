import { Router } from 'express';
import { networkSelector } from '../../middleware/network-selector';
import finalityRouter from './finality';
import btcDelegationsRouter from './btc-delegations';
import btcTransactionsRouter from './btc-transactions';
import transactionsRouter from './transactions';
import paramsRouter from './params';
import blsCheckpointRouter from './bls-checkpoint';
import validatorSignatureRouter from './validator-signature';
import validatorInfoRouter from './validator-info';
import covenantRouter from './covenant';
import governanceRoutes from './governance';
import blockProcessorRouter from './block-processor';
import newStakersRouter from './new-stakers';
import statsRouter from './stats';
import cosmwasmRouter from './cosmwasm.routes';
import rewardsRouter from './rewards';

const v1Router = Router();

// Apply network selector middleware to all v1 routes
v1Router.use(networkSelector);

// Mount v1 routes
v1Router.use('/finality', finalityRouter);
v1Router.use('/btc-delegations', btcDelegationsRouter);
v1Router.use('/btc-transactions', btcTransactionsRouter);
v1Router.use('/transactions', transactionsRouter);
v1Router.use('/bls-checkpoint', blsCheckpointRouter);
v1Router.use('/validator-signatures', validatorSignatureRouter);
v1Router.use('/validator-info', validatorInfoRouter);
v1Router.use('/covenant', covenantRouter);
v1Router.use('/', paramsRouter);
v1Router.use('/governance', governanceRoutes);
v1Router.use('/block-processor', blockProcessorRouter);
v1Router.use('/stakers', newStakersRouter);
v1Router.use('/stats', statsRouter);
v1Router.use('/cosmwasm', cosmwasmRouter);
v1Router.use('/rewards', rewardsRouter);

export default v1Router;