import { Router } from 'express';
import { IBCPacketController } from '../../../controllers/ibc/ibc-packet.controller';
import { networkSelector } from '../../../middleware/network-selector';

const router = Router();

// Get packet statistics
router.get('/stats', networkSelector, IBCPacketController.getPacketStats);

// Get packets by channel
router.get('/channel/:channelId/:portId', networkSelector, IBCPacketController.getPacketsByChannel);

// Get packets by relayer
router.get('/relayer/:relayerAddress', networkSelector, IBCPacketController.getPacketsByRelayer);

export default router; 