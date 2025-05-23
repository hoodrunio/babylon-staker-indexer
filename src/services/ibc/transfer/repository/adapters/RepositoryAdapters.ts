import { Network } from '../../../../../types/finality';
import { 
    IIBCTransferRepository, 
    IIBCChannelRepository, 
    IIBCConnectionRepository, 
    IIBCClientRepository 
} from '../../interfaces/IBCRepositories';
import { IBCTransferRepository } from '../../../repository/IBCTransferRepository';
import { IBCChannelRepository } from '../../../repository/IBCChannelRepository';
import { IBCConnectionRepository } from '../../../repository/IBCConnectionRepository';
import { IBCClientRepository } from '../../../repository/IBCClientRepository';
import mongoose from 'mongoose';

/**
 * Adapter for IBCTransferRepository
 * Implements the IIBCTransferRepository interface using the existing repository
 */
export class IBCTransferRepositoryAdapter implements IIBCTransferRepository {
    private repository: IBCTransferRepository;

    constructor() {
        this.repository = new IBCTransferRepository();
    }

    async saveTransfer(transfer: any, packetId: mongoose.Types.ObjectId, network: Network): Promise<any> {
        return this.repository.saveTransfer(transfer, packetId, network);
    }

    async getTransferByPacketId(packetId: mongoose.Types.ObjectId, network: Network): Promise<any> {
        return this.repository.getTransferByPacketId(packetId, network);
    }

    async getTransferByTxHash(txHash: string, network: Network): Promise<any> {
        return this.repository.getTransferByTxHash(txHash, network);
    }

    async getTransfersBySender(sender: string, network: Network): Promise<any[]> {
        return this.repository.getTransfersBySender(sender, network);
    }
}

/**
 * Adapter for IBCChannelRepository
 * Implements the IIBCChannelRepository interface using the existing repository
 */
export class IBCChannelRepositoryAdapter implements IIBCChannelRepository {
    private repository: IBCChannelRepository;

    constructor() {
        this.repository = new IBCChannelRepository();
    }

    async getChannel(channelId: string, portId: string, network: Network): Promise<any> {
        return this.repository.getChannel(channelId, portId, network);
    }
}

/**
 * Adapter for IBCConnectionRepository
 * Implements the IIBCConnectionRepository interface using the existing repository
 */
export class IBCConnectionRepositoryAdapter implements IIBCConnectionRepository {
    private repository: IBCConnectionRepository;

    constructor() {
        this.repository = new IBCConnectionRepository();
    }

    async getConnection(connectionId: string, network: Network): Promise<any> {
        return this.repository.getConnection(connectionId, network);
    }
}

/**
 * Adapter for IBCClientRepository
 * Implements the IIBCClientRepository interface using the existing repository
 */
export class IBCClientRepositoryAdapter implements IIBCClientRepository {
    private repository: IBCClientRepository;

    constructor() {
        this.repository = new IBCClientRepository();
    }

    async getClient(clientId: string, network: Network): Promise<any> {
        return this.repository.getClient(clientId, network);
    }
}
