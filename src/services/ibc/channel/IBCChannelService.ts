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
        attributes: Map<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.get('port_id');
            const channelId = attributes.get('channel_id');
            const counterpartyPortId = attributes.get('counterparty_port_id');
            const connectionId = attributes.get('connection_id');
            const version = attributes.get('version');
            const ordering = attributes.get('ordering');
            
            if (!portId || !channelId || !counterpartyPortId || !connectionId) {
                logger.warn('[IBCChannelService] Missing required attributes for channel_open_init event');
                return;
            }
            
            // Get connection details to determine counterparty chain
            const connection = await this.channelRepository.getConnection(connectionId, network);
            const counterpartyChainId = connection?.counterparty_chain_id || 'unknown';
            
            // Create new channel
            await this.channelRepository.createChannel({
                channel_id: channelId,
                port_id: portId,
                connection_id: connectionId,
                counterparty_channel_id: '',  // Will be updated in open_try
                counterparty_port_id: counterpartyPortId,
                counterparty_chain_id: counterpartyChainId,
                state: 'INIT',
                ordering: ordering || 'UNORDERED',
                version: version || '',
                created_at: timestamp,
                updated_at: timestamp,
                
                // Initialize analytics fields
                packet_count: 0,
                success_count: 0,
                failure_count: 0,
                timeout_count: 0,
                avg_completion_time_ms: 0,
                total_tokens_transferred: new Map(),
                active_relayers: [],
                
                // Creation metadata
                creation_height: height,
                creation_tx_hash: txHash,
                network
            }, network);
            
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
        attributes: Map<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.get('port_id');
            const channelId = attributes.get('channel_id');
            const counterpartyPortId = attributes.get('counterparty_port_id');
            const counterpartyChannelId = attributes.get('counterparty_channel_id');
            const connectionId = attributes.get('connection_id');
            
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
                await this.channelRepository.createChannel({
                    channel_id: channelId,
                    port_id: portId,
                    connection_id: connectionId,
                    counterparty_channel_id: counterpartyChannelId,
                    counterparty_port_id: counterpartyPortId,
                    counterparty_chain_id: counterpartyChainId,
                    state: 'TRYOPEN',
                    ordering: attributes.get('ordering') || 'UNORDERED',
                    version: attributes.get('version') || '',
                    created_at: timestamp,
                    updated_at: timestamp,
                    
                    // Initialize analytics fields
                    packet_count: 0,
                    success_count: 0,
                    failure_count: 0,
                    timeout_count: 0,
                    avg_completion_time_ms: 0,
                    total_tokens_transferred: new Map(),
                    active_relayers: [],
                    
                    // Creation metadata
                    creation_height: height,
                    creation_tx_hash: txHash,
                    network
                }, network);
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
        attributes: Map<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.get('port_id');
            const channelId = attributes.get('channel_id');
            const counterpartyChannelId = attributes.get('counterparty_channel_id');
            
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
        attributes: Map<string, string>,
        txHash: string, 
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.get('port_id');
            const channelId = attributes.get('channel_id');
            
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
        attributes: Map<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.get('port_id');
            const channelId = attributes.get('channel_id');
            
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
        attributes: Map<string, string>,
        txHash: string,
        height: number,
        timestamp: Date,
        network: Network
    ): Promise<void> {
        try {
            const portId = attributes.get('port_id');
            const channelId = attributes.get('channel_id');
            
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
     * Converts array of key/value attributes to a map for easier access
     */
    private extractEventAttributes(event: any): Map<string, string> {
        const attributesMap = new Map<string, string>();
        
        if (event.attributes && Array.isArray(event.attributes)) {
            for (const attr of event.attributes) {
                if (attr.key && attr.value) {
                    // Keys and values might be base64 encoded
                    try {
                        const key = this.decodeBase64(attr.key);
                        const value = this.decodeBase64(attr.value);
                        attributesMap.set(key, value);
                    } catch (err) {
                        // If decoding fails, use the original values
                        attributesMap.set(attr.key, attr.value);
                    }
                }
            }
        }
        
        return attributesMap;
    }
    
    /**
     * Decode base64 string
     */
    private decodeBase64(str: string): string {
        try {
            // Check if the string is base64 encoded
            if (this.isBase64(str)) {
                return Buffer.from(str, 'base64').toString('utf8');
            }
            return str;
        } catch {
            return str;
        }
    }
    
    /**
     * Check if string is base64 encoded
     */
    private isBase64(str: string): boolean {
        const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
        return base64Regex.test(str);
    }
}
