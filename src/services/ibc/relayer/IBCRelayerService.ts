import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCRelayerRepository } from '../repository/IBCRelayerRepository';
import { IBCChainResolverService } from '../transfer/services/IBCChainResolverService';
import { IBCEventUtils } from '../common/IBCEventUtils';
import { IBCTokenService } from '../transfer/services/IBCTokenService';
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
    private tokenService: IBCTokenService;

    constructor(
        relayerRepository?: IBCRelayerRepository,
        chainResolverService?: IBCChainResolverService
    ) {
        this.relayerRepository = relayerRepository || new IBCRelayerRepository();
        this.tokenService = new IBCTokenService();
        
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
     * @param allEvents All events in the transaction (for extracting transfer data)
     */
    public async processRelayerEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network,
        txSigner?: string,
        allEvents?: any[]
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
            
            // Extract transfer data for volume tracking (only for successful transfers)
            let transferData: { denom: string; amount: string } | undefined;
            if (success && allEvents) {
                transferData = this.extractTransferDataFromEvents(allEvents, event);
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
                destination_chain_id: destChainId,
                // NEW: Transfer data for volume tracking
                transfer_data: transferData
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

    /**
     * Extract transfer data from transaction events for volume tracking
     * @param allEvents All events in the transaction
     * @param currentEvent Current relayer event being processed
     * @returns Transfer data with amount and denomination
     */
    private extractTransferDataFromEvents(allEvents: any[], currentEvent: any): { denom: string; amount: string } | undefined {
        try {
            const currentAttributes = IBCEventUtils.extractEventAttributes(currentEvent);
            const currentMsgIndex = currentAttributes.msg_index;
            
            // Look for fungible_token_packet events that match the current event's msg_index
            const fungibleEvents = allEvents.filter(e => e.type === 'fungible_token_packet');
            
            if (fungibleEvents.length > 0) {
                // Find the fungible_token_packet event that corresponds to the current relayer event
                let matchingFungibleEvent = null;
                
                for (const fungibleEvent of fungibleEvents) {
                    const fungibleAttributes = IBCEventUtils.extractEventAttributes(fungibleEvent);
                    
                    // Match by msg_index to ensure we get the correct transfer data
                    if (fungibleAttributes.msg_index === currentMsgIndex) {
                        matchingFungibleEvent = fungibleEvent;
                        break;
                    }
                }
                
                // If we found a matching fungible event, extract transfer data from it
                if (matchingFungibleEvent) {
                    const attributes = IBCEventUtils.extractEventAttributes(matchingFungibleEvent);
                    if (attributes.amount && attributes.denom) {
                        logger.debug(`[IBCRelayerService] Extracted transfer data from matching fungible_token_packet (msg_index: ${currentMsgIndex}): ${attributes.amount} ${attributes.denom}`);
                        return {
                            amount: attributes.amount,
                            denom: attributes.denom
                        };
                    }
                }
                
                // If no matching msg_index found, try to match by packet details
                const currentSourceChannel = currentAttributes.packet_src_channel;
                const currentDestChannel = currentAttributes.packet_dst_channel;
                const currentSequence = currentAttributes.packet_sequence;
                
                for (const fungibleEvent of fungibleEvents) {
                    const fungibleAttributes = IBCEventUtils.extractEventAttributes(fungibleEvent);
                    
                    // For recv_packet events, look for fungible events that match the packet routing
                    if (currentEvent.type === 'recv_packet') {
                        // The fungible event should have the same routing as the recv_packet
                        if (fungibleAttributes.packet_src_channel === currentSourceChannel &&
                            fungibleAttributes.packet_dst_channel === currentDestChannel &&
                            fungibleAttributes.packet_sequence === currentSequence) {
                            
                            if (fungibleAttributes.amount && fungibleAttributes.denom) {
                                logger.debug(`[IBCRelayerService] Extracted transfer data from recv_packet matching fungible_token_packet: ${fungibleAttributes.amount} ${fungibleAttributes.denom}`);
                                return {
                                    amount: fungibleAttributes.amount,
                                    denom: fungibleAttributes.denom
                                };
                            }
                        }
                    }
                    // For acknowledge_packet events, we need to be more careful
                    else if (currentEvent.type === 'acknowledge_packet') {
                        // For acknowledgments, we should only track volume if we have the original transfer data
                        // The fungible_token_packet in acknowledgment contains the original transfer being acknowledged
                        // We should look for the acknowledgement attribute to confirm this is acknowledgment data
                        if (fungibleAttributes.acknowledgement) {
                            // This is acknowledgment metadata, not new transfer data
                            // We should not count this as new volume
                            logger.debug(`[IBCRelayerService] Skipping acknowledgment fungible_token_packet for volume tracking`);
                            continue;
                        }
                        
                        // If no acknowledgement attribute, this might be the original transfer data
                        if (fungibleAttributes.packet_src_channel === currentSourceChannel &&
                            fungibleAttributes.packet_dst_channel === currentDestChannel &&
                            fungibleAttributes.packet_sequence === currentSequence) {
                            
                            if (fungibleAttributes.amount && fungibleAttributes.denom) {
                                logger.debug(`[IBCRelayerService] Extracted transfer data from acknowledge_packet matching fungible_token_packet: ${fungibleAttributes.amount} ${fungibleAttributes.denom}`);
                                return {
                                    amount: fungibleAttributes.amount,
                                    denom: fungibleAttributes.denom
                                };
                            }
                        }
                    }
                }
            }

            // Fallback: Look for packet_data in the current event
            if (currentAttributes.packet_data) {
                try {
                    const transferData = this.tokenService.parseTransferData(currentAttributes.packet_data);
                    if (transferData.amount && transferData.denom) {
                        logger.debug(`[IBCRelayerService] Extracted transfer data from packet_data: ${transferData.amount} ${transferData.denom}`);
                        return {
                            amount: transferData.amount,
                            denom: transferData.denom
                        };
                    }
                } catch (error) {
                    logger.debug(`[IBCRelayerService] Could not parse packet_data: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            // Additional fallback: Look for send_packet or recv_packet events in the same transaction
            const transferEvents = allEvents.filter(e => e.type === 'send_packet' || e.type === 'recv_packet');
            for (const transferEvent of transferEvents) {
                const transferAttributes = IBCEventUtils.extractEventAttributes(transferEvent);
                
                // Match by msg_index if available
                if (currentMsgIndex && transferAttributes.msg_index === currentMsgIndex) {
                    if (transferAttributes.packet_data) {
                        try {
                            const transferData = this.tokenService.parseTransferData(transferAttributes.packet_data);
                            if (transferData.amount && transferData.denom) {
                                logger.debug(`[IBCRelayerService] Extracted transfer data from matching ${transferEvent.type}: ${transferData.amount} ${transferData.denom}`);
                                return {
                                    amount: transferData.amount,
                                    denom: transferData.denom
                                };
                            }
                        } catch (error) {
                            logger.debug(`[IBCRelayerService] Could not parse packet_data from ${transferEvent.type}: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                }
            }

            logger.debug(`[IBCRelayerService] No matching transfer data found for packet ${currentAttributes.packet_src_channel}/${currentAttributes.packet_sequence}`);
            return undefined;
        } catch (error) {
            logger.error(`[IBCRelayerService] Error extracting transfer data: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }
}
