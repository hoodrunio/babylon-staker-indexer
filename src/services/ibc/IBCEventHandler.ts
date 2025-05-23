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
            
            if (!events?.length) return;
            
            logger.debug(`[IBCEventHandler] Processing tx ${hash} with ${events.length} events`);
            
            const ibcEvents = this.filterIBCEvents(events);
            if (ibcEvents.length === 0) return;
            
            const timestamp = txTimestamp ? new Date(txTimestamp) : new Date();
            const eventProcessingPromises: Promise<void>[] = [];
            
            for (const event of ibcEvents) {
                const promises = await this.processEvent(event, events, hash, height, timestamp, network, signer);
                eventProcessingPromises.push(...promises);
            }
            
            if (eventProcessingPromises.length > 0) {
                await Promise.all(eventProcessingPromises);
                logger.debug(`[IBCEventHandler] Processed ${eventProcessingPromises.length} IBC events from tx ${hash}`);
            }
        } catch (error) {
            logger.error(`[IBCEventHandler] Error processing transaction: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    private async processEvent(
        event: any, 
        allEvents: any[], 
        hash: string, 
        height: number, 
        timestamp: Date, 
        network: Network, 
        signer: string
    ): Promise<Promise<void>[]> {
        const promises: Promise<void>[] = [];

        try {
            if (this.isChannelEvent(event)) {
                promises.push(this.channelService.processChannelEvent(event, hash, height, timestamp, network));
            } 
            else if (this.isConnectionEvent(event)) {
                promises.push(this.connectionService.processConnectionEvent(event, hash, height, timestamp, network));
            }
            else if (this.isClientEvent(event)) {
                promises.push(this.clientService.processClientEvent(event, hash, height, timestamp, network));
            }
            else if (this.isPacketEvent(event)) {
                if (event.type === 'fungible_token_packet') {
                    await this.processFungibleTokenPacket(event, allEvents, hash, height, timestamp, network, signer, promises);
                } else if (this.isAcknowledgmentEvent(event)) {
                    await this.processAcknowledgmentEvent(event, allEvents, hash, height, timestamp, network, signer, promises);
                } else if (this.isTimeoutEvent(event)) {
                    await this.processTimeoutEvent(event, hash, height, timestamp, network, signer, promises);
                } else {
                    await this.processOtherPacketEvent(event, hash, height, timestamp, network, signer, promises);
                }
            }
        } catch (error) {
            logger.error(`[IBCEventHandler] Error processing event ${event.type}: ${error instanceof Error ? error.message : String(error)}`);
        }

        return promises;
    }

    private async processFungibleTokenPacket(
        event: any, 
        allEvents: any[], 
        hash: string, 
        height: number, 
        timestamp: Date, 
        network: Network, 
        signer: string, 
        promises: Promise<void>[]
    ): Promise<void> {
        promises.push(this.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer));
        
        const hasAcknowledgmentEvent = allEvents.some(e => this.isAcknowledgmentEvent(e));
        if (!hasAcknowledgmentEvent) {
            promises.push(this.transferService.processTransferEvent(event, hash, height, timestamp, network));
        }
    }

    private async processAcknowledgmentEvent(
        event: any, 
        allEvents: any[], 
        hash: string, 
        height: number, 
        timestamp: Date, 
        network: Network, 
        signer: string, 
        promises: Promise<void>[]
    ): Promise<void> {
        promises.push(this.packetService.processPacketEvent(event, hash, height, timestamp, network));
        promises.push(this.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer));
        promises.push(this.transferService.processAcknowledgmentEvent(event, hash, height, timestamp, network));
        
        const { tokenAmount, tokenDenom } = this.extractTokenInfoFromTransaction(allEvents);
        promises.push(this.channelService.processPacketStatistics(event, hash, height, timestamp, network, signer, tokenAmount, tokenDenom));
    }

    private async processTimeoutEvent(
        event: any, 
        hash: string, 
        height: number, 
        timestamp: Date, 
        network: Network, 
        signer: string, 
        promises: Promise<void>[]
    ): Promise<void> {
        promises.push(this.packetService.processPacketEvent(event, hash, height, timestamp, network));
        promises.push(this.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer));
        promises.push(this.channelService.processPacketStatistics(event, hash, height, timestamp, network, signer));
        promises.push(this.transferService.processTimeoutEvent(event, hash, height, timestamp, network));
    }

    private async processOtherPacketEvent(
        event: any, 
        hash: string, 
        height: number, 
        timestamp: Date, 
        network: Network, 
        signer: string, 
        promises: Promise<void>[]
    ): Promise<void> {
        promises.push(this.packetService.processPacketEvent(event, hash, height, timestamp, network));
        promises.push(this.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer));
        promises.push(this.channelService.processPacketStatistics(event, hash, height, timestamp, network, signer));
        
        if (this.isTransferEvent(event)) {
            promises.push(this.transferService.processTransferEvent(event, hash, height, timestamp, network));
        }
    }

    /**
     * Extract token information from fungible_token_packet events in the transaction
     * Note: Acknowledgment transactions contain two fungible_token_packet events
     */
    private extractTokenInfoFromTransaction(events: any[]): { tokenAmount: string; tokenDenom: string } {
        const fungibleTokenEvents = events.filter(e => e.type === 'fungible_token_packet');
        
        for (const ftEvent of fungibleTokenEvents) {
            if (ftEvent.attributes) {
                let amount = '';
                let denom = '';
                
                for (const attr of ftEvent.attributes) {
                    if (attr.key === 'amount' && attr.value) amount = attr.value;
                    if (attr.key === 'denom' && attr.value) denom = attr.value;
                }
                
                if (amount && denom) {
                    return { tokenAmount: amount, tokenDenom: denom };
                }
            }
        }
        
        return { tokenAmount: '', tokenDenom: '' };
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
        const isTransferType = event.type.includes('transfer_packet') || 
                           event.type.includes('fungible_token_packet') || 
                           event.type === 'send_packet' ||
                           event.type === 'recv_packet';
        
        if (isTransferType && (event.type === 'send_packet' || event.type === 'recv_packet')) {
            return event.attributes?.some?.((attr: { key: string; value: string }) => 
                (attr.key === 'packet_src_port' && attr.value === 'transfer') || 
                (attr.key === 'packet_dst_port' && attr.value === 'transfer')
            );
        }
        
        return isTransferType;
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
}
