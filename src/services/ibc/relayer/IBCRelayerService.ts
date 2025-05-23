import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCRelayerRepository } from '../repository/IBCRelayerRepository';
import { IBCChainResolverService } from '../transfer/services/IBCChainResolverService';
import { IBCEventUtils } from '../common/IBCEventUtils';
import { 
    IBCChannelRepositoryAdapter, 
    IBCConnectionRepositoryAdapter,
    IBCClientRepositoryAdapter 
} from '../transfer/repository/adapters/RepositoryAdapters';
import { BabylonClient } from '../../../clients/BabylonClient';

/**
 * Service responsible for tracking and managing IBC relayers
 * Following Single Responsibility Principle - focuses only on relayer operations
 */
export class IBCRelayerService {
    private readonly serviceName = 'IBCRelayerService';
    private relayerRepository: IBCRelayerRepository;
    private chainResolverService: IBCChainResolverService;

    constructor(
        relayerRepository?: IBCRelayerRepository,
        chainResolverService?: IBCChainResolverService
    ) {
        this.relayerRepository = relayerRepository || new IBCRelayerRepository();
        
        if (chainResolverService) {
            this.chainResolverService = chainResolverService;
        } else {
            // Create chain resolver service with default dependencies
            const channelRepository = new IBCChannelRepositoryAdapter();
            const connectionRepository = new IBCConnectionRepositoryAdapter();
            const clientRepository = new IBCClientRepositoryAdapter();
            const babylonClient = BabylonClient.getInstance();
            
            this.chainResolverService = new IBCChainResolverService(
                channelRepository, 
                connectionRepository, 
                clientRepository, 
                babylonClient
            );
        }
    }

    /**
     * Process an event to identify and track relayers
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     * @param txSigner Optional transaction signer
     */
    public async processRelayerEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network,
        txSigner?: string
    ): Promise<void> {
        try {
            IBCEventUtils.logEventStart(this.serviceName, event.type, txHash);
            
            logger.debug(`[IBCRelayerService] Processing event for relayer tracking: ${event.type} in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = IBCEventUtils.extractEventAttributes(event);
            
            // Use the transaction signer if available (extracted from the IBC message content)
            let signer = '';
            if (txSigner) {
                signer = txSigner;
                logger.debug(`[IBCRelayerService] Using IBC message signer as relayer: ${signer}`);
            }
            
            // If no signer from IBC message content, fall back to checking event attributes
            if (!signer) {
                signer = attributes.signer;
                
                if (signer) {
                    logger.debug(`[IBCRelayerService] Found signer in event attributes: ${signer}`);
                }
            }
            
            if (!signer) {
                // If we still can't identify the relayer, skip this event
                logger.debug(`[IBCRelayerService] Could not identify relayer for tx ${txHash}, skipping`);
                return;
            }
            
            // Extract packet information from event
            const sourcePort = attributes.packet_src_port;
            const sourceChannel = attributes.packet_src_channel;
            const destPort = attributes.packet_dst_port;
            const destChannel = attributes.packet_dst_channel;
            const sequence = attributes.packet_sequence;
            
            if (!sourcePort || !sourceChannel || !sequence) {
                // If packet info is missing, we can't associate with specific packet
                return;
            }
            
            // Determine the relayer action based on event type
            let action = '';
            // Track if packet was successful or not
            let success = true;
            
            switch (event.type) {
                case 'recv_packet':
                    action = 'RECEIVE_PACKET';
                    // Check for error attribute
                    if (attributes.error || attributes.packet_error) {
                        success = false;
                    }
                    break;
                    
                case 'acknowledge_packet':
                    action = 'ACKNOWLEDGE_PACKET';
                    // Acknowledgments are generally considered successful
                    success = true;
                    break;
                    
                case 'timeout_packet':
                    action = 'TIMEOUT_PACKET';
                    // Timeouts indicate a failure to deliver within the expected timeframe
                    success = false;
                    break;
                    
                default:
                    // Other packet events are not typically relayed
                    return;
            }
            
            // Resolve chain information using the same service as transfer
            let sourceChainId = '';
            let destChainId = '';
            
            try {
                const chainInfo = await this.chainResolverService.getTransferChainInfo(
                    event.type,
                    sourceChannel,
                    sourcePort,
                    destChannel,
                    destPort,
                    network
                );
                
                if (chainInfo) {
                    sourceChainId = chainInfo.source?.chain_id || '';
                    destChainId = chainInfo.destination?.chain_id || '';
                    logger.debug(`[IBCRelayerService] Resolved chains: ${sourceChainId} -> ${destChainId}`);
                }
            } catch (error) {
                logger.debug(`[IBCRelayerService] Could not resolve chain info: ${error instanceof Error ? error.message : String(error)}`);
            }
            
            // Create relayer activity record with complete information
            const relayerData = {
                address: signer,
                tx_hash: txHash,
                height,
                timestamp,
                action,
                source_port: sourcePort,
                source_channel: sourceChannel,
                destination_port: destPort,
                destination_channel: destChannel,
                sequence,
                success,
                network: network.toString(),
                // Additional fields for statistics
                channel_id: sourceChannel,
                port_id: sourcePort,
                source_chain_id: sourceChainId,
                destination_chain_id: destChainId
            };
            
            // Log success or failure for monitoring
            if (success) {
                logger.debug(`[IBCRelayerService] Successful relay by ${signer} for ${sourcePort}/${sourceChannel}/${sequence}`);
            } else {
                logger.warn(`[IBCRelayerService] Failed relay by ${signer} for ${sourcePort}/${sourceChannel}/${sequence}`);
            }
            
            await this.relayerRepository.trackRelayerActivity(relayerData, network);
        } catch (error) {
            logger.error(`[IBCRelayerService] Error processing relayer event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get statistics for a specific relayer
     * @param address Relayer address
     * @param network Network to query
     */
    public async getRelayerStats(address: string, network: Network): Promise<any> {
        try {
            return await this.relayerRepository.getRelayer(address, network);
        } catch (error) {
            logger.error(`[IBCRelayerService] Error getting relayer stats: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
}
