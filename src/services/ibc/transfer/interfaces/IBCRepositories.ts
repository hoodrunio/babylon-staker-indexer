import { Network } from '../../../../types/finality';
import mongoose from 'mongoose';

/**
 * Interface for IBC transfer repository operations
 */
export interface IIBCTransferRepository {
    saveTransfer(transfer: any, packetId: mongoose.Types.ObjectId, network: Network): Promise<any>;
    getTransferByPacketId(packetId: mongoose.Types.ObjectId, network: Network): Promise<any>;
    getTransferByTxHash(txHash: string, network: Network): Promise<any>;
    getTransfersBySender(sender: string, network: Network): Promise<any[]>;
}

/**
 * Interface for IBC channel repository operations
 */
export interface IIBCChannelRepository {
    getChannel(channelId: string, portId: string, network: Network): Promise<any>;
}

/**
 * Interface for IBC connection repository operations
 */
export interface IIBCConnectionRepository {
    getConnection(connectionId: string, network: Network): Promise<any>;
}

/**
 * Interface for IBC client repository operations
 */
export interface IIBCClientRepository {
    getClient(clientId: string, network: Network): Promise<any>;
}
