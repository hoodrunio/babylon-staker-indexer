import { logger } from '../../utils/logger';
import { Network } from '../../types/finality';
import { IBCServiceManager } from './core/IBCServiceManager';

/**
 * Simplified IBC Module that delegates to the service manager
 * Acts as a facade for the entire IBC indexing system
 */
export class IBCModule {
    private static instance: IBCModule | null = null;
    private serviceManager: IBCServiceManager;

    private constructor() {
        this.serviceManager = IBCServiceManager.getInstance();
        logger.info('[IBCModule] Initialized with service manager');
    }

    public static getInstance(): IBCModule {
        if (!IBCModule.instance) {
            IBCModule.instance = new IBCModule();
        }
        return IBCModule.instance;
    }

    /**
     * Initialize the IBC module
     */
    public async initialize(): Promise<void> {
        logger.info('[IBCModule] Initializing IBC module');
        await this.serviceManager.initialize();
        logger.info('[IBCModule] IBC module initialized successfully');
    }

    /**
     * Shutdown the IBC module gracefully
     */
    public async shutdown(): Promise<void> {
        logger.info('[IBCModule] Shutting down IBC module');
        await this.serviceManager.shutdown();
        logger.info('[IBCModule] IBC module shut down successfully');
    }

    /**
     * Start historical sync from a specific height
     * @param network Network to process
     * @param fromHeight Optional starting height
     * @param blockCount Optional number of blocks to process
     */
    public async startHistoricalSync(
        network: Network, 
        fromHeight?: number, 
        blockCount?: number
    ): Promise<void> {
        logger.info(`[IBCModule] Starting historical sync for ${network}`);
        await this.serviceManager.processHistoricalBlocks(fromHeight, blockCount);
        logger.info(`[IBCModule] Historical sync completed for ${network}`);
    }

    // Service access methods (delegation to service manager)
    public getChannelService() { return this.serviceManager.getChannelService(); }
    public getConnectionService() { return this.serviceManager.getConnectionService(); }
    public getClientService() { return this.serviceManager.getClientService(); }
    public getPacketService() { return this.serviceManager.getPacketService(); }
    public getTransferService() { return this.serviceManager.getTransferService(); }
    public getRelayerService() { return this.serviceManager.getRelayerService(); }
    public getStateRepository() { return this.serviceManager.getStateRepository(); }
    public getBlockProcessor() { return this.serviceManager.getBlockProcessor(); }
    public getReconciliationService() { return this.serviceManager.getReconciliationService(); }
    public getEventHandler() { return this.serviceManager.getEventHandler(); }
    public getMessageProcessor() { return this.serviceManager.getMessageProcessor(); }
}
