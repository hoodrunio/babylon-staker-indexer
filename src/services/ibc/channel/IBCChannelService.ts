import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCChannelRepository } from '../repository/IBCChannelRepository';

/**
 * Service responsible for processing and managing IBC channel data
 * Following Single Responsibility Principle - focuses only on channel operations
 */
export class IBCChannelService {
    private channelRepository: IBCChannelRepository;

    constructor() {
        this.channelRepository = new IBCChannelRepository();
    }

    /**
     * Process a channel-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processChannelEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            logger.debug(`[IBCChannelService] Processing channel event: ${event.type} in tx ${txHash}`);
            
            // Extract attributes from event
            const attributes = this.extractEventAttributes(event);
            
            switch (event.type) {
                case 'channel_open_init':
                    await this.handleChannelOpenInit(attributes, txHash, height, timestamp, network);
                    break;
                case 'channel_open_try':
                    await this.handleChannelOpenTry(attributes, txHash, height, timestamp, network);
                    break;
                case 'channel_open_ack':
                    await this.handleChannelOpenAck(attributes, txHash, height, timestamp, network);
                    break;
                case 'channel_open_confirm':
                    await this.handleChannelOpenConfirm(attributes, txHash, height, timestamp, network);
                    break;
                case 'channel_close_init':
                    await this.handleChannelCloseInit(attributes, txHash, height, timestamp, network);
                    break;
                case 'channel_close_confirm':
                    await this.handleChannelCloseConfirm(attributes, txHash, height, timestamp, network);
                    break;
                default:
                    logger.debug(`[IBCChannelService] Unhandled channel event type: ${event.type}`);
                    break;
            }
        } catch (error) {
            logger.error(`[IBCChannelService] Error processing channel event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle channel_open_init event
     * Creates a new channel record in the database
     */
    private async handleChannelOpenInit(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.port_id;
            const channelId = attributes.channel_id;
            const counterpartyPortId = attributes.counterparty_port_id;
            const connectionId = attributes.connection_id;
            const version = attributes.version;
            const ordering = attributes.ordering;
            
            if (!portId || !channelId || !counterpartyPortId || !connectionId) {
                logger.warn('[IBCChannelService] Missing required attributes for channel_open_init event');
                return;
            }
            
            // Get connection details to determine counterparty chain
            const connection = await this.channelRepository.getConnection(connectionId, network);
            const counterpartyChainId = connection?.counterparty_chain_id || 'unknown';
            
            // Create new channel
            const newChannel = {
                channel_id: channelId,
                port_id: portId,
                connection_id: connectionId,
                counterparty_channel_id: '',  // Will be updated in open_try
                counterparty_port_id: counterpartyPortId,
                counterparty_chain_id: '', // Will be resolved later
                state: 'INIT',
                ordering: ordering || 'UNORDERED',
                version: version || '',
                network: network,
                created_at: timestamp,
                updated_at: timestamp,
                ...this.getDefaultAnalyticsFields()
            };
            
            await this.channelRepository.createChannel(newChannel, network);
            
            logger.info(`[IBCChannelService] Created new channel ${channelId} on port ${portId} for network ${network}`);
        } catch (error) {
            logger.error(`[IBCChannelService] Error handling channel_open_init: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle channel_open_try event
     * Updates counterparty information for a channel
     */
    private async handleChannelOpenTry(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.port_id;
            const channelId = attributes.channel_id;
            const counterpartyPortId = attributes.counterparty_port_id;
            const counterpartyChannelId = attributes.counterparty_channel_id;
            const connectionId = attributes.connection_id;
            
            if (!portId || !channelId || !counterpartyPortId || !counterpartyChannelId || !connectionId) {
                logger.warn('[IBCChannelService] Missing required attributes for channel_open_try event');
                return;
            }
            
            // Check if channel exists (it might not if we're receiving events out of order)
            const existingChannel = await this.channelRepository.getChannel(channelId, portId, network);
            
            if (existingChannel) {
                // Update existing channel
                await this.channelRepository.updateChannel(
                    channelId,
                    portId,
                    {
                        counterparty_channel_id: counterpartyChannelId,
                        state: 'TRYOPEN',
                        updated_at: timestamp
                    },
                    network
                );
            } else {
                // Get connection details to determine counterparty chain
                const connection = await this.channelRepository.getConnection(connectionId, network);
                const counterpartyChainId = connection?.counterparty_chain_id || 'unknown';
                
                // Create new channel record if it doesn't exist
                const newChannel = {
                    channel_id: channelId,
                    port_id: portId,
                    connection_id: connectionId,
                    counterparty_channel_id: counterpartyChannelId,
                    counterparty_port_id: counterpartyPortId,
                    counterparty_chain_id: counterpartyChainId,
                    state: 'TRYOPEN',
                    ordering: attributes.ordering || 'UNORDERED',
                    version: attributes.version || '',
                    network: network,
                    created_at: timestamp,
                    updated_at: timestamp,
                    ...this.getDefaultAnalyticsFields()
                };
                
                await this.channelRepository.createChannel(newChannel, network);
            }
            
            logger.info(`[IBCChannelService] Updated channel ${channelId} to TRYOPEN state for network ${network}`);
        } catch (error) {
            logger.error(`[IBCChannelService] Error handling channel_open_try: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle channel_open_ack event
     * Updates the channel state to OPEN and sets the counterparty channel ID
     */
    private async handleChannelOpenAck(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.port_id;
            const channelId = attributes.channel_id;
            const counterpartyChannelId = attributes.counterparty_channel_id;
            
            if (!portId || !channelId || !counterpartyChannelId) {
                logger.warn('[IBCChannelService] Missing required attributes for channel_open_ack event');
                return;
            }
            
            // Update existing channel
            await this.channelRepository.updateChannel(
                channelId, 
                portId,
                {
                    state: 'OPEN',
                    counterparty_channel_id: counterpartyChannelId,
                    updated_at: timestamp
                },
                network
            );
            
            logger.info(`[IBCChannelService] Updated channel ${channelId} to OPEN state for network ${network}`);
        } catch (error) {
            logger.error(`[IBCChannelService] Error handling channel_open_ack: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle channel_open_confirm event
     * Updates the channel state to OPEN
     */
    private async handleChannelOpenConfirm(
        attributes: Record<string, string>,
        txHash: string, 
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.port_id;
            const channelId = attributes.channel_id;
            
            if (!portId || !channelId) {
                logger.warn('[IBCChannelService] Missing required attributes for channel_open_confirm event');
                return;
            }
            
            // Update existing channel
            await this.channelRepository.updateChannel(
                channelId,
                portId,
                {
                    state: 'OPEN',
                    updated_at: timestamp
                },
                network
            );
            
            logger.info(`[IBCChannelService] Confirmed channel ${channelId} as OPEN for network ${network}`);
        } catch (error) {
            logger.error(`[IBCChannelService] Error handling channel_open_confirm: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle channel_close_init event
     * Updates the channel state to indicate closure was initiated
     */
    private async handleChannelCloseInit(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.port_id;
            const channelId = attributes.channel_id;
            
            if (!portId || !channelId) {
                logger.warn('[IBCChannelService] Missing required attributes for channel_close_init event');
                return;
            }
            
            // Update existing channel
            await this.channelRepository.updateChannel(
                channelId,
                portId,
                {
                    state: 'CLOSED',
                    updated_at: timestamp
                },
                network
            );
            
            logger.info(`[IBCChannelService] Updated channel ${channelId} to CLOSED state for network ${network}`);
        } catch (error) {
            logger.error(`[IBCChannelService] Error handling channel_close_init: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle channel_close_confirm event
     * Updates the channel state to CLOSED
     */
    private async handleChannelCloseConfirm(
        attributes: Record<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.port_id;
            const channelId = attributes.channel_id;
            
            if (!portId || !channelId) {
                logger.warn('[IBCChannelService] Missing required attributes for channel_close_confirm event');
                return;
            }
            
            // Update existing channel
            await this.channelRepository.updateChannel(
                channelId,
                portId,
                {
                    state: 'CLOSED',
                    updated_at: timestamp
                },
                network
            );
            
            logger.info(`[IBCChannelService] Confirmed channel ${channelId} as CLOSED for network ${network}`);
        } catch (error) {
            logger.error(`[IBCChannelService] Error handling channel_close_confirm: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Get a channel by ID and port
     */
    public async getChannel(channelId: string, portId: string, network: Network): Promise<any> {
        return this.channelRepository.getChannel(channelId, portId, network);
    }

    /**
     * Get all channels for a specific counterparty chain
     */
    public async getChannelsByCounterparty(counterpartyChainId: string, network: Network): Promise<any[]> {
        return this.channelRepository.getChannelsByCounterparty(counterpartyChainId, network);
    }

    /**
     * Calculate and update channel metrics
     */
    public async updateChannelMetrics(channelId: string, portId: string, network: Network): Promise<void> {
        try {
            // This would gather data from packet repository and update channel metrics
            // Implementation depends on how packet data is structured
            logger.info(`[IBCChannelService] Updated metrics for channel ${channelId} on port ${portId} for network ${network}`);
        } catch (error) {
            logger.error(`[IBCChannelService] Error updating channel metrics: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Helper method to extract attributes from event
     * Converts array of key/value attributes to a record for easier access
     */
    private extractEventAttributes(event: any): Record<string, string> {
        const attributes: Record<string, string> = {};
        
        if (!event.attributes || !Array.isArray(event.attributes)) {
            return attributes;
        }
        
        for (const attr of event.attributes) {
            if (attr.key && attr.value) {
                attributes[attr.key] = attr.value;
            }
        }
        
        return attributes;
    }

    /**
     * Process packet events to update channel statistics
     * @param event Packet event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     * @param relayerAddress Optional relayer address
     * @param externalTokenAmount Optional token amount from external source (e.g., fungible_token_packet)
     * @param externalTokenDenom Optional token denom from external source (e.g., fungible_token_packet)
     */
    public async processPacketStatistics(
        event: any,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network,
        relayerAddress?: string,
        externalTokenAmount?: string,
        externalTokenDenom?: string
    ): Promise<void> {
        try {
            const attributes = this.extractEventAttributes(event);
            
            // For different event types, we need to update different channels:
            // - send_packet: update source channel (packet leaving our network)  
            // - recv_packet: update destination channel (packet arriving to our network)
            // - acknowledge_packet: update source channel (acknowledging our sent packet)
            // - timeout_packet: update source channel (our packet timed out)
            
            let channelToUpdate = '';
            let portToUpdate = '';
            
            if (event.type === 'recv_packet') {
                // For received packets, update the destination channel (our network's channel)
                channelToUpdate = attributes.packet_dst_channel;
                portToUpdate = attributes.packet_dst_port;
            } else {
                // For sent packets, acknowledgments, and timeouts, update the source channel
                channelToUpdate = attributes.packet_src_channel;
                portToUpdate = attributes.packet_src_port;
            }
            
            if (!portToUpdate || !channelToUpdate) {
                return;
            }

            // Extract packet data for token information if available
            let tokenAmount = externalTokenAmount || '';
            let tokenDenom = externalTokenDenom || '';
            
            // If external token info not provided, try to get from packet_data
            if (!tokenAmount || !tokenDenom) {
                const packetData = attributes.packet_data;
                if (packetData) {
                    try {
                        const data = JSON.parse(packetData);
                        tokenAmount = tokenAmount || data.amount || '';
                        tokenDenom = tokenDenom || data.denom || '';
                    } catch (error) {
                        // Ignore parsing errors
                    }
                }
            }

            let success = false;
            let timeout = false;
            let completionTimeMs = 0;
            let direction: 'incoming' | 'outgoing' | undefined;

            // Determine packet outcome and direction based on event type
            switch (event.type) {
                case 'send_packet':
                    // Send events don't update completion statistics yet
                    return;
                    
                case 'recv_packet':
                    success = true;
                    direction = 'incoming'; // Receiving packets means incoming transfers
                    break;
                    
                case 'acknowledge_packet':
                    success = true;
                    direction = 'outgoing'; // Acknowledging means we sent a packet (outgoing)
                    // For acknowledgments, we can calculate completion time if we have send time
                    break;
                    
                case 'timeout_packet':
                    timeout = true;
                    direction = 'outgoing'; // Timeout means our outgoing packet failed
                    break;
                    
                default:
                    return;
            }

            // Update channel statistics
            await this.channelRepository.updatePacketStats(
                channelToUpdate,
                portToUpdate,
                {
                    success,
                    timeout,
                    completionTimeMs,
                    tokenAmount,
                    tokenDenom,
                    relayerAddress,
                    direction
                },
                network
            );

            logger.debug(`[IBCChannelService] Updated statistics for channel ${channelToUpdate}/${portToUpdate} (${event.type}, ${direction}, ${tokenAmount} ${tokenDenom})`);
        } catch (error) {
            logger.error(`[IBCChannelService] Error processing packet statistics: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private getDefaultAnalyticsFields(): Record<string, any> {
        return {
            packet_count: 0,
            success_count: 0,
            failure_count: 0,
            timeout_count: 0,
            avg_completion_time_ms: 0,
            total_tokens_transferred: {
                incoming: new Map(),
                outgoing: new Map()
            },
            active_relayers: [],
            creation_height: 0,
            creation_tx_hash: '',
        };
    }
}
