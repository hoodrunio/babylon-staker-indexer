import { Request, Response } from 'express';
import { IBCPacketCleaner } from '../../../services/ibc/packet-cleaner/IBCPacketCleaner';
import { IBCQueryClient } from '../../../services/ibc/packet-cleaner/IBCQueryClient';
import { ChainConfigService } from '../../../services/ibc/packet-cleaner/ChainConfigService';
import { TimeoutPacketRequest } from '../../../services/ibc/packet-cleaner/types';
import { logger } from '../../../utils/logger';

export class PacketCleanerController {
  private packetCleaner: IBCPacketCleaner;

  constructor() {
    this.packetCleaner = new IBCPacketCleaner();
  }

  /**
   * Clear timed-out packets for a specific channel
   * POST /api/v1/ibc/channels/:channelId/clear-packets
   */
  public clearPackets = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const { 
        port_id, 
        source_chain_id, 
        destination_chain_id 
      } = req.body;

      // Validate required parameters
      if (!port_id || !source_chain_id || !destination_chain_id) {
        res.status(400).json({
          success: false,
          message: 'Missing required parameters: port_id, source_chain_id, destination_chain_id'
        });
        return;
      }

      logger.info('[PacketCleanerController] Received packet clearing request', {
        channelId,
        port_id,
        source_chain_id,
        destination_chain_id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      const request: TimeoutPacketRequest = {
        channel_id: channelId,
        port_id,
        source_chain_id,
        destination_chain_id
      };

      // Execute packet clearing
      const result = await this.packetCleaner.clearTimedOutPackets(request);

      // Log the result
      logger.info('[PacketCleanerController] Packet clearing completed', {
        channelId,
        success: result.success,
        cleared_packets: result.cleared_packets,
        errors: result.errors.length
      });

      // Return result
      res.status(result.success ? 200 : 400).json({
        success: result.success,
        message: result.message,
        data: {
          channel_id: channelId,
          port_id,
          cleared_packets: result.cleared_packets,
          transaction_hashes: result.transaction_hashes,
          errors: result.errors,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error: any) {
      logger.error('[PacketCleanerController] Error in clearPackets:', error);
      
      res.status(500).json({
        success: false,
        message: 'Internal server error occurred while clearing packets',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };

  /**
   * Get information about a specific channel
   * GET /api/v1/ibc/channels/:channelId/info
   */
  public getChannelInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const { port_id, chain_id } = req.query;

      if (!port_id || !chain_id) {
        res.status(400).json({
          success: false,
          message: 'Missing required query parameters: port_id, chain_id'
        });
        return;
      }

      logger.info('[PacketCleanerController] Received channel info request', {
        channelId,
        port_id,
        chain_id
      });

      // Query actual channel information
      const chainConfigService = ChainConfigService.getInstance();
      const chainConfig = chainConfigService.getChainConfig(chain_id as string);

      if (!chainConfig) {
        res.status(400).json({
          success: false,
          message: `Chain configuration not found for ${chain_id}`
        });
        return;
      }

      const queryClient = new IBCQueryClient(chainConfig);
      const channelInfo = await queryClient.queryChannel(port_id as string, channelId);

      if (!channelInfo) {
        res.status(404).json({
          success: false,
          message: `Channel ${channelId}/${port_id} not found on chain ${chain_id}`
        });
        return;
      }

      res.json({
        success: true,
        message: 'Channel information retrieved successfully',
        data: {
          channel_id: channelId,
          port_id: port_id,
          chain_id: chain_id,
          state: channelInfo.state,
          ordering: channelInfo.ordering,
          counterparty: {
            port_id: channelInfo.counterparty.port_id,
            channel_id: channelInfo.counterparty.channel_id
          },
          connection_hops: channelInfo.connection_hops,
          version: channelInfo.version,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error: any) {
      logger.error('[PacketCleanerController] Error in getChannelInfo:', error);
      
      res.status(500).json({
        success: false,
        message: 'Internal server error occurred while fetching channel info',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };

  /**
   * Get list of supported chains
   * GET /api/v1/ibc/supported-chains
   */
  public getSupportedChains = async (req: Request, res: Response): Promise<void> => {
    try {
      logger.info('[PacketCleanerController] Received supported chains request');

      const chainConfigService = ChainConfigService.getInstance();
      const chainIds = chainConfigService.getAllChainIds();

      const supportedChains = chainIds.map(chainId => {
        const config = chainConfigService.getChainConfig(chainId);
        if (!config) return null;

        let name = '';
        let type = '';

        // Determine chain name and type based on chain_id
        switch (config.chain_id) {
          case 'bbn-1':
            name = 'Babylon Mainnet';
            type = 'mainnet';
            break;
          case 'bbn-test-3':
            name = 'Babylon Testnet';
            type = 'testnet';
            break;
          case 'cosmoshub-4':
            name = 'Cosmos Hub';
            type = 'mainnet';
            break;
          case 'osmosis-1':
            name = 'Osmosis';
            type = 'mainnet';
            break;
          default:
            name = config.chain_id;
            type = 'unknown';
        }

        return {
          config_id: chainId,
          chain_id: config.chain_id,
          name: name,
          type: type,
          rpc_url: config.rpc_url,
          prefix: config.prefix,
          status: 'active'
        };
      }).filter(Boolean);

      res.json({
        success: true,
        message: 'Supported chains retrieved successfully',
        data: {
          chains: supportedChains,
          total: supportedChains.length,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error: any) {
      logger.error('[PacketCleanerController] Error in getSupportedChains:', error);
      
      res.status(500).json({
        success: false,
        message: 'Internal server error occurred while fetching supported chains',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
} 