import { Router } from 'express';
import { PacketCleanerController } from '../../../controllers/ibc/PacketCleanerController';

const router = Router();
const packetCleanerController = new PacketCleanerController();

/**
 * @route POST /api/v1/ibc/channels/:channelId/clear-packets
 * @desc Clear timed-out packets for a specific IBC channel
 * @access Public
 * @param {string} channelId - The IBC channel ID (e.g., "channel-0")
 * @body {string} port_id - The port ID (e.g., "transfer")
 * @body {string} source_chain_id - Source chain ID (e.g., "bbn-1")
 * @body {string} destination_chain_id - Destination chain ID (e.g., "cosmoshub-4")
 */
router.post('/channels/:channelId/clear-packets', packetCleanerController.clearPackets);

/**
 * @route GET /api/v1/ibc/channels/:channelId/info
 * @desc Get information about a specific IBC channel
 * @access Public
 * @param {string} channelId - The IBC channel ID
 * @query {string} port_id - The port ID
 * @query {string} chain_id - The chain ID
 */
router.get('/channels/:channelId/info', packetCleanerController.getChannelInfo);

/**
 * @route GET /api/v1/ibc/supported-chains
 * @desc Get list of supported chains for packet clearing
 * @access Public
 */
router.get('/supported-chains', packetCleanerController.getSupportedChains);

export default router; 