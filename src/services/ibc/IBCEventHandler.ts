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
            const ibcEvents = this.filterIBCEvents(events);
            
            if (ibcEvents.length === 0) {
                return;
            }
            
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
                        eventProcessingPromises.push(
                            this.packetService.processPacketEvent(event, hash, height, timestamp, network)
                        );
                        
                        // Also process this event to identify and track relayers
                        // Pass signer information to help identify the relayer
                        eventProcessingPromises.push(
                            this.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer)
                        );
                        
                        // Check if this packet represents an IBC transfer
                        if (this.isTransferEvent(event)) {
                            eventProcessingPromises.push(
                                this.transferService.processTransferEvent(event, hash, height, timestamp, network)
                            );
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
        return event.type.includes('transfer_packet');
    }
}
