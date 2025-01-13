import { Router } from 'express';
import { networkSelector } from '../../middleware/network-selector';
import finalityRouter from './finality';

const v1Router = Router();

// Apply network selector middleware to all v1 routes
v1Router.use(networkSelector);

// Mount v1 routes
v1Router.use('/finality', finalityRouter);

export default v1Router; 