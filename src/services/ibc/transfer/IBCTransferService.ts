import { Network } from '../../../types/finality';
import { IBCEvent } from './types/IBCTransferTypes';
import { IIBCEventProcessorService } from './interfaces/IBCServices';
import { IBCEventProcessorService } from './services/IBCEventProcessorService';
import { IBCChainResolverService } from './services/IBCChainResolverService';
import { IBCPacketService } from './services/IBCPacketService';
import { IBCTokenService } from './services/IBCTokenService';
import { IBCTransferStatusService } from './services/IBCTransferStatusService';
import { 
    IBCTransferRepositoryAdapter, 
    IBCChannelRepositoryAdapter, 
    IBCConnectionRepositoryAdapter,
    IBCClientRepositoryAdapter 
} from './repository/adapters/RepositoryAdapters';
import { BabylonClient } from '../../../clients/BabylonClient';

/**
 * Service responsible for processing and managing IBC transfer data
 * Following Single Responsibility Principle and Dependency Inversion Principle
 * Acts as a facade to the specialized services
 */
export class IBCTransferService {
    private eventProcessor: IIBCEventProcessorService;

    constructor() {
        // Create repository adapters
        const transferRepository = new IBCTransferRepositoryAdapter();
        const channelRepository = new IBCChannelRepositoryAdapter();
        const connectionRepository = new IBCConnectionRepositoryAdapter();
        const clientRepository = new IBCClientRepositoryAdapter();
        const babylonClient = BabylonClient.getInstance();
        
        // Create specialized services
        const chainResolver = new IBCChainResolverService(channelRepository, connectionRepository, clientRepository, babylonClient);
        const packetService = new IBCPacketService();
        const tokenService = new IBCTokenService();
        const statusService = new IBCTransferStatusService();
        
        // Create event processor that handles the coordination
        this.eventProcessor = new IBCEventProcessorService(
            transferRepository,
            chainResolver,
            packetService,
            tokenService,
            statusService
        );
    }

    /**
     * Process a transfer-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processTransferEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        return this.eventProcessor.processTransferEvent(event as IBCEvent, txHash, height, timestamp, network);
    }

    /**
     * Process an acknowledgment event to update an existing transfer
     * @param event Acknowledgment event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processAcknowledgmentEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        return this.eventProcessor.processAcknowledgmentEvent(event as IBCEvent, txHash, height, timestamp, network);
    }

    /**
     * Process a timeout event to mark a transfer as failed
     * @param event Timeout event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    public async processTimeoutEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void> {
        return this.eventProcessor.processTimeoutEvent(event as IBCEvent, txHash, height, timestamp, network);
    }
}