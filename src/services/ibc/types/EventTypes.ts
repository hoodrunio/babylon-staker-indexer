import { Network } from '../../../types/finality';

/**
 * Extracted event attributes for better type safety
 */
export interface EventAttributes {
    [key: string]: string;
}

/**
 * Common context for all IBC event processing
 */
export interface IBCEventContext {
    txHash: string;
    blockHeight: number;
    timestamp: Date;
    network: Network;
    signer: string;
    allEvents: any[];
    tokenAmount?: string;
    tokenDenom?: string;
}

/**
 * Base interface for IBC events
 */
export interface IBCEvent {
    type: string;
    attributes: EventAttributes;
}

/**
 * Channel event types
 */
export interface ChannelEvent extends IBCEvent {
    type: 'channel_open_init' | 'channel_open_try' | 'channel_open_ack' | 
          'channel_open_confirm' | 'channel_close_init' | 'channel_close_confirm';
}

/**
 * Connection event types
 */
export interface ConnectionEvent extends IBCEvent {
    type: 'connection_open_init' | 'connection_open_try' | 
          'connection_open_ack' | 'connection_open_confirm';
}

/**
 * Client event types
 */
export interface ClientEvent extends IBCEvent {
    type: 'create_client' | 'update_client' | 'upgrade_client' | 'client_misbehaviour';
}

/**
 * Packet event types
 */
export interface PacketEvent extends IBCEvent {
    type: 'send_packet' | 'recv_packet' | 'write_acknowledgement' | 
          'acknowledge_packet' | 'timeout_packet' | 'fungible_token_packet';
}

/**
 * Transfer event types
 */
export interface TransferEvent extends IBCEvent {
    type: 'ibc_transfer' | 'fungible_token_packet';
}

/**
 * Union type for all IBC events
 */
export type AnyIBCEvent = ChannelEvent | ConnectionEvent | ClientEvent | PacketEvent | TransferEvent; 