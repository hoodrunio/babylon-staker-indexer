import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';
import { ChainInfo, TransferChainContext } from '../types/IBCTransferTypes';
import { IIBCChainResolverService } from '../interfaces/IBCServices';
import { IIBCChannelRepository, IIBCConnectionRepository, IIBCClientRepository } from '../interfaces/IBCRepositories';
import { getChainName } from '../../constants/chainMapping';

/**
 * Service responsible for resolving chain information from IBC identifiers
 */
export class IBCChainResolverService implements IIBCChainResolverService {
    constructor(
        private readonly channelRepository: IIBCChannelRepository,
        private readonly connectionRepository: IIBCConnectionRepository,
        private readonly clientRepository: IIBCClientRepository
    ) {}

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
     * Get destination chain information for a transfer
     * @param sourceChannel Source channel ID
     * @param sourcePort Source port ID
     * @param destChannel Destination channel ID
     * @param destPort Destination port ID 
     * @param network Network context
     * @returns Object with source and destination chain information
     */
    public async getTransferChainInfo(
        sourceChannel: string,
        sourcePort: string,
        destChannel: string,
        destPort: string,
        network: Network
    ): Promise<TransferChainContext> {
        // Initialize without default values - we'll resolve everything dynamically
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
            // For destination chain, use destination channel (the channel packets are going to)
            if (destChannel && destPort) {
                const destChainInfo = await this.getChainInfoFromChannel(destChannel, destPort, network);
                if (destChainInfo && destChainInfo.chain_id) {
                    result.destination = destChainInfo;
                    logger.debug(`[IBCChainResolverService] Resolved destination chain info: ${JSON.stringify(destChainInfo)}`);
                }
            }
            
            // For source chain
            if (sourceChannel && sourcePort) {
                const sourceChainInfo = await this.getChainInfoFromChannel(sourceChannel, sourcePort, network);
                if (sourceChainInfo && sourceChainInfo.chain_id) {
                    result.source = sourceChainInfo;
                    logger.debug(`[IBCChainResolverService] Resolved source chain info: ${JSON.stringify(sourceChainInfo)}`);
                }
            }
            
            return result;
        } catch (error) {
            logger.error(`[IBCChainResolverService] Error getting transfer chain info: ${error instanceof Error ? error.message : String(error)}`);
            return result;
        }
    }
}
