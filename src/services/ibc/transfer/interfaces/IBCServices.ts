import { Network } from '../../../../types/finality';
import { IBCEvent, IBCTransferData, TransferChainContext, ChainInfo, IBCPacketInfo } from '../types/IBCTransferTypes';
import mongoose from 'mongoose';

/**
 * Interface for IBC event processing service
 */
export interface IIBCEventProcessorService {
    processTransferEvent(event: IBCEvent, txHash: string, height: number, timestamp: Date, network: Network): Promise<void>;
    processAcknowledgmentEvent(event: IBCEvent, txHash: string, height: number, timestamp: Date, network: Network): Promise<void>;
    processTimeoutEvent(event: IBCEvent, txHash: string, height: number, timestamp: Date, network: Network): Promise<void>;
}

/**
 * Interface for IBC chain resolution service
 */
export interface IIBCChainResolverService {
    getChainInfoFromChannel(channelId: string, portId: string, network: Network): Promise<ChainInfo | null>;
    getTransferChainInfo(sourceChannel: string, sourcePort: string, destChannel: string, destPort: string, network: Network): Promise<TransferChainContext>;
}

/**
 * Interface for IBC packet identifier service
 */
export interface IIBCPacketService {
    extractEventAttributes(event: IBCEvent): Record<string, string>;
    createPacketId(port: string, channel: string, sequence: string): mongoose.Types.ObjectId;
    extractPacketInfo(attributes: Record<string, string>): IBCPacketInfo | null;
}

/**
 * Interface for IBC token formatting service
 */
export interface IIBCTokenService {
    extractTokenSymbol(denom: string): string;
    formatTokenAmount(amount: string, symbol: string): string;
    parseTransferData(packetData: any): any;
}

/**
 * Interface for IBC transfer status service
 */
export interface IIBCTransferStatusService {
    isSuccessfulAcknowledgement(attributes: Record<string, string>): boolean;
    updateTransferForAcknowledgement(transfer: IBCTransferData, txHash: string, height: number, timestamp: Date, isSuccessful: boolean, error?: string): IBCTransferData;
    updateTransferForTimeout(transfer: IBCTransferData, txHash: string, height: number, timestamp: Date): IBCTransferData;
}
