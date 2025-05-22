import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';
import { ChainInfo, TransferChainContext } from '../types/IBCTransferTypes';
import { IIBCChainResolverService } from '../interfaces/IBCServices';
import { IIBCChannelRepository, IIBCConnectionRepository, IIBCClientRepository } from '../interfaces/IBCRepositories';
import { getChainName } from '../../constants/chainMapping';
import { BabylonClient } from '../../../../clients/BabylonClient';
/**
 * Service responsible for resolving chain information from IBC identifiers
 */
export class IBCChainResolverService implements IIBCChainResolverService {
    constructor(
        private readonly channelRepository: IIBCChannelRepository,
        private readonly connectionRepository: IIBCConnectionRepository,
        private readonly clientRepository: IIBCClientRepository,
        private readonly babylonClient: BabylonClient
    ) {}

    /**
     * Get the local chain ID based on the network
     * @param network The current network
     * @returns Chain information with chain_id and chain_name
     */
    private getLocalChainInfo(): ChainInfo {
        // Map network to chain ID
        const network = this.babylonClient.getNetwork();
        const chainId = network === Network.MAINNET ? 'bbn-1' : 'bbn-test-5';
        const chainName = getChainName(chainId);
        
        return {
            chain_id: chainId,
            chain_name: chainName
        };
    }

    /**
     * Get chain information by following the client-connection-channel relationship
     * @param channelId The channel ID
     * @param portId The port ID
     * @param network Network context
     * @returns Chain information (id and name) or null if not found
     */
    public async getChainInfoFromChannel(channelId: string, portId: string, network: Network): Promise<ChainInfo | null> {
        try {
            logger.debug(`[IBCChainResolverService] Looking up chain info for channel ${channelId} on port ${portId}`);
            
            // Step 1: Get the channel
            const channel = await this.channelRepository.getChannel(channelId, portId, network);
            if (!channel) {
                logger.warn(`[IBCChainResolverService] Channel not found: ${channelId} on port ${portId}`);
                return null;
            }
            
            // Step 2: Get the connection using connection_id from the channel
            const connectionId = channel.connection_id;
            if (!connectionId) {
                logger.warn(`[IBCChainResolverService] No connection_id found for channel ${channelId}`);
                return null;
            }
            
            logger.debug(`[IBCChainResolverService] Found connection_id ${connectionId} for channel ${channelId}`);
            const connection = await this.connectionRepository.getConnection(connectionId, network);
            if (!connection) {
                logger.warn(`[IBCChainResolverService] Connection not found: ${connectionId}`);
                return null;
            }
            
            // Step 3: Get the client using client_id from the connection
            const clientId = connection.client_id;
            if (!clientId) {
                logger.warn(`[IBCChainResolverService] No client_id found for connection ${connectionId}`);
                return null;
            }
            
            logger.debug(`[IBCChainResolverService] Found client_id ${clientId} for connection ${connectionId}`);
            const client = await this.clientRepository.getClient(clientId, network);
            if (!client) {
                logger.warn(`[IBCChainResolverService] Client not found: ${clientId}`);
                return null;
            }
            
            // Step 4: Get the chain_id from the client and map to readable name
            const chainId = client.chain_id;
            if (!chainId) {
                logger.warn(`[IBCChainResolverService] No chain_id found for client ${clientId}`);
                return null;
            }
            
            // Convert chain ID to readable name using the mapping utility
            const chainName = getChainName(chainId);
            logger.debug(`[IBCChainResolverService] Resolved channel ${channelId} to chain ${chainId} (${chainName})`);
            
            return {
                chain_id: chainId,
                chain_name: chainName
            };
        } catch (error) {
            logger.error(`[IBCChainResolverService] Error resolving chain from channel: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    
    /**
     * Determines if we are processing an outbound transfer (from Babylon to another chain)
     * or an inbound transfer (from another chain to Babylon)
     * @param eventType The event type (send_packet, recv_packet, etc)
     * @param sourceChannel Source channel ID
     * @param destChannel Destination channel ID
     * @returns true if outbound, false if inbound
     */
    private isOutboundTransfer(eventType: string, sourceChannel: string, destChannel: string): boolean {
        // If it's a send_packet event and the source channel is one of ours, it's outbound
        if (eventType === 'send_packet') {
            return true;
        }
        
        // If it's a recv_packet event, it's inbound
        if (eventType === 'recv_packet') {
            return false;
        }
        
        // For other events like acknowledge_packet, we need to check the channels
        // Our channels usually start with 'channel-' and a low number
        const isSourceChannelLocal = sourceChannel && sourceChannel.match(/^channel-\d+$/) && 
                                  parseInt(sourceChannel.split('-')[1]) < 100;
        const isDestChannelLocal = destChannel && destChannel.match(/^channel-\d+$/) && 
                                parseInt(destChannel.split('-')[1]) < 100;
        
        // If source is local and dest is remote, it's outbound
        if (isSourceChannelLocal && !isDestChannelLocal) {
            return true;
        }
        
        // If source is remote and dest is local, it's inbound
        if (!isSourceChannelLocal && isDestChannelLocal) {
            return false;
        }
        
        // Default to checking if the source channel matches our typical pattern
        return isSourceChannelLocal || false;
    }
    
    /**
     * Get transfer chain information for a transfer
     * @param eventType The event type (send_packet, recv_packet, etc)
     * @param sourceChannel Source channel ID
     * @param sourcePort Source port ID
     * @param destChannel Destination channel ID
     * @param destPort Destination port ID 
     * @param network Network context
     * @returns Object with source and destination chain information
     */
    public async getTransferChainInfo(
        eventType: string,
        sourceChannel: string,
        sourcePort: string,
        destChannel: string,
        destPort: string,
        network: Network
    ): Promise<TransferChainContext> {
        // Get the local chain info
        const localChainInfo = this.getLocalChainInfo();
        
        // Initialize result with empty values
        const result: TransferChainContext = {
            source: {
                chain_id: '',
                chain_name: ''
            },
            destination: {
                chain_id: '',
                chain_name: ''
            }
        };
        
        try {
            // Determine if this is an outbound or inbound transfer
            const isOutbound = this.isOutboundTransfer(eventType, sourceChannel, destChannel);
            logger.debug(`[IBCChainResolverService] Transfer direction: ${isOutbound ? 'outbound' : 'inbound'} for event ${eventType}`);
            
            // For outbound transfers: source is local chain, destination is remote chain
            if (isOutbound) {
                // Source is our local chain
                result.source = localChainInfo;
                
                // Destination is determined by the channel relationship
                if (destChannel && destPort) {
                    // Try to resolve destination using our local database
                    // For outbound transfers, we need to look up the counterparty chain info
                    try {
                        // First look up our own channel to get the counterparty info
                        const channel = await this.channelRepository.getChannel(sourceChannel, sourcePort, network);
                        if (channel && channel.counterparty_channel_id === destChannel) {
                            // Use the connection to find the client and its chain ID
                            const connectionId = channel.connection_id;
                            if (connectionId) {
                                const connection = await this.connectionRepository.getConnection(connectionId, network);
                                if (connection && connection.client_id) {
                                    const client = await this.clientRepository.getClient(connection.client_id, network);
                                    if (client && client.chain_id) {
                                        result.destination = {
                                            chain_id: client.chain_id,
                                            chain_name: getChainName(client.chain_id)
                                        };
                                        logger.debug(`[IBCChainResolverService] Resolved destination chain: ${result.destination.chain_id}`);
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        logger.error(`[IBCChainResolverService] Error resolving destination chain: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
            // For inbound transfers: source is remote chain, destination is local chain
            else {
                // Destination is our local chain
                result.destination = localChainInfo;
                
                // Source is determined by the channel relationship
                if (sourceChannel && sourcePort) {
                    // Try to resolve source using our local database
                    try {
                        // For inbound transfers, we need to look up the counterparty chain info
                        const channel = await this.channelRepository.getChannel(destChannel, destPort, network);
                        if (channel && channel.counterparty_channel_id === sourceChannel) {
                            // Use the connection to find the client and its chain ID
                            const connectionId = channel.connection_id;
                            if (connectionId) {
                                const connection = await this.connectionRepository.getConnection(connectionId, network);
                                if (connection && connection.client_id) {
                                    const client = await this.clientRepository.getClient(connection.client_id, network);
                                    if (client && client.chain_id) {
                                        result.source = {
                                            chain_id: client.chain_id,
                                            chain_name: getChainName(client.chain_id)
                                        };
                                        logger.debug(`[IBCChainResolverService] Resolved source chain: ${result.source.chain_id}`);
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        logger.error(`[IBCChainResolverService] Error resolving source chain: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
            
            // Log the resolved chain information
            logger.debug(`[IBCChainResolverService] Resolved chain info: ` + 
                         `source=${result.source.chain_id || 'unknown'}(${result.source.chain_name || 'unknown'}), ` + 
                         `destination=${result.destination.chain_id || 'unknown'}(${result.destination.chain_name || 'unknown'})`);
            
            return result;
        } catch (error) {
            logger.error(`[IBCChainResolverService] Error getting transfer chain info: ${error instanceof Error ? error.message : String(error)}`);
            return result;
        }
    }
}
