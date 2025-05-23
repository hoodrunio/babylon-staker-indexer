import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCEventUtils } from '../common/IBCEventUtils';

// Service interfaces
import { IBCChannelService } from '../channel/IBCChannelService';
import { IBCConnectionService } from '../connection/IBCConnectionService';
import { IBCClientService } from '../client/IBCClientService';
import { IBCPacketService } from '../packet/IBCPacketService';
import { IBCTransferService } from '../transfer/IBCTransferService';
import { IBCRelayerService } from '../relayer/IBCRelayerService';

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
 * Service dependencies for IBCEventHandler
 */
export interface IBCEventHandlerDependencies {
    channelService: IBCChannelService;
    connectionService: IBCConnectionService;
    clientService: IBCClientService;
    packetService: IBCPacketService;
    transferService: IBCTransferService;
    relayerService: IBCRelayerService;
}

/**
 * Refactored event handler for IBC events
 * Uses dependency injection for better testability and separation of concerns
 */
export class IBCEventHandler {
    private readonly services: IBCEventHandlerDependencies;

    constructor(dependencies: IBCEventHandlerDependencies) {
        this.services = dependencies;
        logger.info('[IBCEventHandler] Initialized with dependency injection');
    }

    /**
     * Process IBC-related events from a transaction
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
                promises.push(this.services.channelService.processChannelEvent(event, hash, height, timestamp, network));
            } 
            else if (this.isConnectionEvent(event)) {
                promises.push(this.services.connectionService.processConnectionEvent(event, hash, height, timestamp, network));
            }
            else if (this.isClientEvent(event)) {
                promises.push(this.services.clientService.processClientEvent(event, hash, height, timestamp, network));
            }
            else if (this.isPacketEvent(event)) {
                if (event.type === 'send_packet' || event.type === 'recv_packet') {
                    await this.processTransferPacketEvent(event, allEvents, hash, height, timestamp, network, signer, promises);
                } else if (event.type === 'fungible_token_packet') {
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

    /**
     * Common processing for transfer-related packet events (send_packet, recv_packet)
     * These events create new transfer records
     */
    private async processTransferPacketEvent(
        event: any, 
        allEvents: any[], 
        hash: string, 
        height: number, 
        timestamp: Date, 
        network: Network, 
        signer: string, 
        promises: Promise<void>[]
    ): Promise<void> {
        // Common packet processing
        await this.processCommonPacketOperations(event, hash, height, timestamp, network, signer, promises);
        
        // Create transfer record for send_packet and recv_packet events
        promises.push(this.services.transferService.processTransferEvent(event, hash, height, timestamp, network));
    }

    /**
     * Common operations for all packet events
     */
    private async processCommonPacketOperations(
        event: any, 
        hash: string, 
        height: number, 
        timestamp: Date, 
        network: Network, 
        signer: string, 
        promises: Promise<void>[],
        tokenAmount?: string,
        tokenDenom?: string
    ): Promise<void> {
        // Always process packet data
        promises.push(this.services.packetService.processPacketEvent(event, hash, height, timestamp, network));
        
        // Always process relayer tracking
        promises.push(this.services.relayerService.processRelayerEvent(event, hash, height, timestamp, network, signer));
        
        // Update channel statistics
        promises.push(this.services.channelService.processPacketStatistics(event, hash, height, timestamp, network, signer, tokenAmount, tokenDenom));
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
        // Extract token information for statistics
        const { tokenAmount, tokenDenom } = this.extractTokenInfoFromEvent(event);
        
        // Common packet processing with token information
        await this.processCommonPacketOperations(event, hash, height, timestamp, network, signer, promises, tokenAmount, tokenDenom);
        
        // Only process transfer events if there's no acknowledgment in the same transaction
        // This handles supplementary data enrichment
        const hasAcknowledgmentEvent = allEvents.some(e => this.isAcknowledgmentEvent(e));
        if (!hasAcknowledgmentEvent) {
            promises.push(this.services.transferService.processTransferEvent(event, hash, height, timestamp, network));
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
        // Extract token information from transaction
        const { tokenAmount, tokenDenom } = this.extractTokenInfoFromTransaction(allEvents);
        
        // Common packet processing
        await this.processCommonPacketOperations(event, hash, height, timestamp, network, signer, promises, tokenAmount, tokenDenom);
        
        // Process acknowledgment to update existing transfer
        promises.push(this.services.transferService.processAcknowledgmentEvent(event, hash, height, timestamp, network));
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
        // Common packet processing
        await this.processCommonPacketOperations(event, hash, height, timestamp, network, signer, promises);
        
        // Process timeout to update existing transfer
        promises.push(this.services.transferService.processTimeoutEvent(event, hash, height, timestamp, network));
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
        // Common packet processing
        await this.processCommonPacketOperations(event, hash, height, timestamp, network, signer, promises);
        
        // Only process transfer events for specific event types
        if (this.isTransferEvent(event)) {
            promises.push(this.services.transferService.processTransferEvent(event, hash, height, timestamp, network));
        }
    }

    /**
     * Extract token information from a specific fungible_token_packet event
     */
    private extractTokenInfoFromEvent(event: any): { tokenAmount: string; tokenDenom: string } {
        const attributes = IBCEventUtils.extractEventAttributes(event);
        return {
            tokenAmount: attributes.amount || '0',
            tokenDenom: attributes.denom || 'unknown'
        };
    }

    /**
     * Extract token information from fungible_token_packet events in the transaction
     */
    private extractTokenInfoFromTransaction(events: any[]): { tokenAmount: string; tokenDenom: string } {
        const fungibleEvents = events.filter(e => e.type === 'fungible_token_packet');
        
        if (fungibleEvents.length > 0) {
            const attributes = IBCEventUtils.extractEventAttributes(fungibleEvents[0]);
            return {
                tokenAmount: attributes.amount || '0',
                tokenDenom: attributes.denom || 'unknown'
            };
        }
        
        return { tokenAmount: '0', tokenDenom: 'unknown' };
    }

    /**
     * Filter events to only include IBC-related ones
     */
    private filterIBCEvents(events: any[]): any[] {
        if (!Array.isArray(events)) return [];
        
        return events.filter(event => 
            this.isChannelEvent(event) ||
            this.isConnectionEvent(event) ||
            this.isClientEvent(event) ||
            this.isPacketEvent(event) ||
            this.isTransferEvent(event)
        );
    }
    
    // Event type checkers
    private isChannelEvent(event: any): boolean {
        return [
            'channel_open_init', 'channel_open_try', 'channel_open_ack', 'channel_open_confirm',
            'channel_close_init', 'channel_close_confirm'
        ].includes(event.type);
    }
    
    private isConnectionEvent(event: any): boolean {
        return [
            'connection_open_init', 'connection_open_try', 'connection_open_ack', 'connection_open_confirm'
        ].includes(event.type);
    }
    
    private isClientEvent(event: any): boolean {
        return [
            'create_client', 'update_client', 'upgrade_client', 'client_misbehaviour'
        ].includes(event.type);
    }
    
    private isPacketEvent(event: any): boolean {
        return [
            'send_packet', 'recv_packet', 'write_acknowledgement', 'acknowledge_packet',
            'timeout_packet', 'fungible_token_packet'
        ].includes(event.type);
    }
    
    private isTransferEvent(event: any): boolean {
        return event.type === 'ibc_transfer' || event.type === 'fungible_token_packet';
    }
    
    private isAcknowledgmentEvent(event: any): boolean {
        return event.type === 'acknowledge_packet' || event.type === 'write_acknowledgement';
    }

    private isTimeoutEvent(event: any): boolean {
        return event.type === 'timeout_packet';
    }
} 