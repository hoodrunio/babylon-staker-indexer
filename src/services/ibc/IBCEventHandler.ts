import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { IBCChannelService } from './channel/IBCChannelService';
import { IBCConnectionService } from './connection/IBCConnectionService';
import { IBCClientService } from './client/IBCClientService';
import { IBCPacketService } from './packet/IBCPacketService';
import { IBCTransferService } from './transfer/IBCTransferService';
import { IBCRelayerService } from './relayer/IBCRelayerService';

/**
 * Transaction data structure received from websocket
 */
export interface TransactionData {
    height: number;
    hash: string;
    events: any[];
    signer?: string;
    timestamp?: string;
}

/**
 * Main handler for IBC events received via websocket
 * This follows the same pattern as other event handlers in the system
 */
export class IBCEventHandler {
    private static instance: IBCEventHandler | null = null;
    
    // Service dependencies
    private channelService: IBCChannelService;
    private connectionService: IBCConnectionService;
    private clientService: IBCClientService;
    private packetService: IBCPacketService;
    private transferService: IBCTransferService;
    private relayerService: IBCRelayerService;

    private constructor() {
        // Initialize services
        this.channelService = new IBCChannelService();
        this.connectionService = new IBCConnectionService();
        this.clientService = new IBCClientService();
        this.packetService = new IBCPacketService(); 
        this.transferService = new IBCTransferService();
        this.relayerService = new IBCRelayerService();
        
        logger.info('[IBCEventHandler] Initialized successfully');
    }

    public static getInstance(): IBCEventHandler {
        if (!IBCEventHandler.instance) {
            IBCEventHandler.instance = new IBCEventHandler();
        }
        return IBCEventHandler.instance;
    }

    /**
     * Process IBC-related events from a transaction
     * @param txData Transaction data from websocket
     * @param network Network where transaction occurred
     */
    public async handleEvent(txData: TransactionData, network: Network): Promise<void> {
        try {
            const { height, hash, events, signer = '', timestamp: txTimestamp } = txData;
            
            // Skip if no events
            if (!events || !events.length) {
                return;
            }
            
            logger.debug(`[IBCEventHandler] Processing tx ${hash} at height ${height} with ${events.length} events`);
            if (signer) {
                logger.debug(`[IBCEventHandler] Transaction signer: ${signer}`);
            }
            
            // Filter IBC-related events
            let ibcEvents = this.filterIBCEvents(events);
            
            if (ibcEvents.length === 0) {
                return;
            }
            
            // Sort events to ensure proper processing order
            // Primary events (with routing info) should be processed before supplementary events
            ibcEvents = this.sortEventsByProcessingPriority(ibcEvents);
            
            // Process timestamp (from transaction or current time if not available)
            const timestamp = txTimestamp ? new Date(txTimestamp) : new Date();
            
            // Process events by category
            const eventProcessingPromises: Promise<void>[] = [];
            
            for (const event of ibcEvents) {
                try {
                    // Delegate to specialized service based on event type
                    if (this.isChannelEvent(event)) {
                        eventProcessingPromises.push(
                            this.channelService.processChannelEvent(event, hash, height, timestamp, network)
                        );
                    } 
                    else if (this.isConnectionEvent(event)) {
                        eventProcessingPromises.push(
                            this.connectionService.processConnectionEvent(event, hash, height, timestamp, network)
                        );
                    }
                    else if (this.isClientEvent(event)) {
                        eventProcessingPromises.push(
                            this.clientService.processClientEvent(event, hash, height, timestamp, network)
                        );
                    }
                    else if (this.isPacketEvent(event)) {
                        // Special handling for fungible_token_packet events
                        // These should only go to the transfer service and relayer service
                        if (event.type === 'fungible_token_packet') {
                            // Process with relayer service
                            eventProcessingPromises.push(
                                this.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer)
                            );
                            
                            // Process with transfer service
                            eventProcessingPromises.push(
                                this.transferService.processTransferEvent(event, hash, height, timestamp, network)
                            );
                        } 
                        // 2. Acknowledgments of existing transfers
                        else if (this.isAcknowledgmentEvent(event)) {
                            // Process with the standard packet service
                            eventProcessingPromises.push(
                                this.packetService.processPacketEvent(event, hash, height, timestamp, network)
                            );
                            
                            // Also track relayers
                            eventProcessingPromises.push(
                                this.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer)
                            );
                            
                            // For ack events, we need to update any associated transfer
                            eventProcessingPromises.push(
                                this.transferService.processAcknowledgmentEvent(event, hash, height, timestamp, network)
                            );
                        }
                        // 3. Timeouts of existing transfers
                        else if (this.isTimeoutEvent(event)) {
                            // Process with the standard packet service
                            eventProcessingPromises.push(
                                this.packetService.processPacketEvent(event, hash, height, timestamp, network)
                            );
                            
                            // Also track relayers
                            eventProcessingPromises.push(
                                this.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer)
                            );
                            
                            // For timeout events, we need to update any associated transfer as failed
                            eventProcessingPromises.push(
                                this.transferService.processTimeoutEvent(event, hash, height, timestamp, network)
                            );
                        }
                        // Other packet events (send_packet, recv_packet, etc.)
                        else {
                            // For all other packet events, use the standard packet service
                            eventProcessingPromises.push(
                                this.packetService.processPacketEvent(event, hash, height, timestamp, network)
                            );
                            
                            // Also process this event to identify and track relayers
                            eventProcessingPromises.push(
                                this.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer)
                            );
                            
                            // If this is a transfer event, process it with the transfer service
                            if (this.isTransferEvent(event)) {
                                eventProcessingPromises.push(
                                    this.transferService.processTransferEvent(event, hash, height, timestamp, network)
                                );
                            }
                        }
                    }
                } catch (eventError) {
                    // Log error but continue processing other events
                    logger.error(`[IBCEventHandler] Error processing event ${event.type}: ${eventError instanceof Error ? eventError.message : String(eventError)}`);
                }
            }
            
            // Wait for all event processing to complete
            if (eventProcessingPromises.length > 0) {
                await Promise.all(eventProcessingPromises);
                logger.debug(`[IBCEventHandler] Successfully processed ${eventProcessingPromises.length} IBC events from tx ${hash}`);
            }
        } catch (error) {
            logger.error(`[IBCEventHandler] Error processing transaction events: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Filter IBC-related events from all transaction events
     */
    private filterIBCEvents(events: any[]): any[] {
        return events.filter(event => 
            event.type.startsWith('ibc.') || 
            event.type.includes('channel') || 
            event.type.includes('client') ||
            event.type.includes('connection') || 
            event.type.includes('packet')
        );
    }
    
    /**
     * Check if event is related to IBC channels
     */
    private isChannelEvent(event: any): boolean {
        return event.type.includes('channel') && 
              !event.type.includes('packet');
    }
    
    /**
     * Check if event is related to IBC connections
     */
    private isConnectionEvent(event: any): boolean {
        return event.type.includes('connection') && 
              !event.type.includes('packet');
    }
    
    /**
     * Check if event is related to IBC clients
     */
    private isClientEvent(event: any): boolean {
        return event.type.includes('client');
    }
    
    /**
     * Check if event is related to IBC packets
     */
    private isPacketEvent(event: any): boolean {
        return event.type.includes('packet');
    }
    
    /**
     * Check if packet event represents an IBC transfer
     */
    private isTransferEvent(event: any): boolean {
        // Check event type first
        const isTransferType = event.type.includes('transfer_packet') || 
                           event.type.includes('fungible_token_packet') || 
                           event.type === 'send_packet';
        
        if (isTransferType) {
            // For send_packet, only consider it a transfer if it's from/to the transfer port
            if (event.type === 'send_packet') {
                // Need to check attributes to verify it's a transfer
                const hasTransferPort = event.attributes?.some?.((attr: { key: string; value: string }) => 
                    (attr.key === 'packet_src_port' && attr.value === 'transfer') || 
                    (attr.key === 'packet_dst_port' && attr.value === 'transfer')
                );
                
                return hasTransferPort;
            }
            
            return true;
        }
        
        return false;
    }
    
    /**
     * Check if packet event represents an acknowledgment
     */
    private isAcknowledgmentEvent(event: any): boolean {
        return event.type.includes('acknowledge_packet');
    }
    
    /**
     * Check if packet event represents a timeout
     */
    private isTimeoutEvent(event: any): boolean {
        return event.type.includes('timeout_packet');
    }
    
    /**
     * Sort events to ensure proper processing order
     * Events with routing information should be processed before supplementary events
     * @param events Array of events to sort
     * @returns Sorted events array
     */
    private sortEventsByProcessingPriority(events: any[]): any[] {
        // Define event type priorities (lower number = higher priority)
        const eventPriority: Record<string, number> = {
            // Core routing events first
            'create_client': 10,
            'update_client': 11,
            'create_connection': 20,
            'open_connection': 21,
            'connection_open': 22,
            'create_channel': 30,
            'open_channel': 31,
            'channel_open': 32,
            
            // Packet events with routing information
            'send_packet': 40,
            'recv_packet': 41,
            'acknowledge_packet': 42,
            'timeout_packet': 43,
            'write_acknowledgement': 44,
            
            // Supplementary events last
            'fungible_token_packet': 90,
            'transfer_packet': 91,
        };
        
        // Sort based on priority
        return [...events].sort((a, b) => {
            const typeA = a.type;
            const typeB = b.type;
            
            // Get priorities, default to 100 if not found
            const priorityA = eventPriority[typeA] || 100;
            const priorityB = eventPriority[typeB] || 100;
            
            // Sort by priority
            return priorityA - priorityB;
        });
    }
}
