import { Router } from 'express';
import { IBCChannelController } from '../../../controllers/ibc/ibc-channel.controller';
import { networkSelector } from '../../../middleware/network-selector';

const router = Router();

// Get all channels
router.get('/', networkSelector, IBCChannelController.getAllChannels);

// Get channel statistics
router.get('/stats', networkSelector, IBCChannelController.getChannelStats);

// Get channels by counterparty chain
router.get('/counterparty/:chainId', networkSelector, IBCChannelController.getChannelsByCounterparty);

// Get channel by ID and port
router.get('/:channelId/:portId', networkSelector, IBCChannelController.getChannel);

// Get channel activity/metrics
router.get('/:channelId/:portId/activity', networkSelector, IBCChannelController.getChannelActivity);

export default router; 