import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { BabylonClient } from '../../../clients/BabylonClient';
import { WebSocketMessageService } from '../../websocket/WebSocketMessageService';

// Service implementations
import { IBCEventHandler } from '../events/IBCEventHandler';
import { IBCMessageProcessor } from '../processors/IBCMessageProcessor';
import { IBCEventDispatcher } from '../event/IBCEventDispatcher';

/**
 * Central service manager for the IBC module
 * Implements dependency injection and service lifecycle management
 */
export class IBCServiceManager {
    private static instance: IBCServiceManager | null = null;
    
    // Core dependencies
    private babylonClient: BabylonClient;
    private network: Network;
    
    // Infrastructure services
    private stateRepository: any;
    private blockProcessor: any;
    private reconciliationService: any;
    
    // Domain services
    private channelService: any;
    private connectionService: any;
    private clientService: any;
    private packetService: any;
    private transferService: any;
    private relayerService: any;
    
    // Event handling
    private eventHandler: IBCEventHandler | null = null;
    private messageProcessor: IBCMessageProcessor | null = null;
    private eventDispatcher: IBCEventDispatcher | null = null;
    
    // State management
    private initialized: boolean = false;
    
    private constructor() {
        this.babylonClient = BabylonClient.getInstance();
        this.network = this.babylonClient.getNetwork();
    }
    
    public static getInstance(): IBCServiceManager {
        if (!IBCServiceManager.instance) {
            IBCServiceManager.instance = new IBCServiceManager();
        }
        return IBCServiceManager.instance;
    }
    
    /**
     * Initialize all IBC services with proper dependency injection
     */
    private async initializeServices(): Promise<void> {
        try {
            // Dynamically import services to avoid initialization issues
            const { IBCStateRepository } = await import('../repository/IBCStateRepository');
            const { IBCBlockProcessor } = await import('../block/IBCBlockProcessor');
            const { IBCReconciliationService } = await import('../reconciliation/IBCReconciliationService');
            
            const { IBCChannelService } = await import('../channel/IBCChannelService');
            const { IBCConnectionService } = await import('../connection/IBCConnectionService');
            const { IBCClientService } = await import('../client/IBCClientService');
            const { IBCPacketService } = await import('../packet/IBCPacketService');
            const { IBCTransferService } = await import('../transfer/IBCTransferService');
            const { IBCRelayerService } = await import('../relayer/IBCRelayerService');
            
            // Import repository classes for chain resolver
            const { IBCChannelRepository } = await import('../repository/IBCChannelRepository');
            const { IBCConnectionRepository } = await import('../repository/IBCConnectionRepository');
            const { IBCClientRepository } = await import('../repository/IBCClientRepository');
            const { IBCChainResolverService } = await import('../transfer/services/IBCChainResolverService');
            
            // Initialize infrastructure services first
            this.stateRepository = new IBCStateRepository();
            this.reconciliationService = new IBCReconciliationService();
            
            // Initialize repositories for chain resolver
            const channelRepository = new IBCChannelRepository();
            const connectionRepository = new IBCConnectionRepository();
            const clientRepository = new IBCClientRepository();
            
            // Initialize chain resolver service
            const chainResolver = new IBCChainResolverService(
                channelRepository,
                connectionRepository,
                clientRepository,
                this.babylonClient
            );
            
            // Initialize domain services
            this.channelService = new IBCChannelService();
            this.connectionService = new IBCConnectionService();
            this.clientService = new IBCClientService();
            this.packetService = new IBCPacketService(undefined, chainResolver);
            this.transferService = new IBCTransferService();
            this.relayerService = new IBCRelayerService();
            
            // Initialize event handling with dependencies
            this.eventHandler = new IBCEventHandler({
                channelService: this.channelService,
                connectionService: this.connectionService,
                clientService: this.clientService,
                packetService: this.packetService,
                transferService: this.transferService,
                relayerService: this.relayerService
            });
            
            // Initialize event dispatcher with the event handler
            this.eventDispatcher = new IBCEventDispatcher(this.eventHandler);
            
            // Initialize block processor with event dispatcher
            this.blockProcessor = new IBCBlockProcessor(this.babylonClient, this.eventDispatcher);
            
            this.messageProcessor = new IBCMessageProcessor(this.eventHandler);
            
            logger.info('[IBCServiceManager] Services initialized successfully');
        } catch (error) {
            logger.error(`[IBCServiceManager] Failed to initialize services: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Initialize the IBC module
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            logger.warn('[IBCServiceManager] Already initialized');
            return;
        }
        
        try {
            logger.info('[IBCServiceManager] Initializing IBC module');
            
            // Initialize services first
            await this.initializeServices();
            
            // Register message processor with WebSocket service
            await this.registerMessageProcessor();
            
            // Start reconciliation service if enabled
            if (this.isReconciliationEnabled()) {
                await this.startReconciliationService();
            }
            
            this.initialized = true;
            logger.info('[IBCServiceManager] IBC module initialized successfully');
        } catch (error) {
            logger.error(`[IBCServiceManager] Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Shutdown the IBC module gracefully
     */
    public async shutdown(): Promise<void> {
        logger.info('[IBCServiceManager] Shutting down IBC module');
        
        try {
            // Stop reconciliation service
            if (this.reconciliationService && this.reconciliationService.stop) {
                this.reconciliationService.stop();
            }
            
            this.initialized = false;
            logger.info('[IBCServiceManager] IBC module shut down successfully');
        } catch (error) {
            logger.error(`[IBCServiceManager] Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Register message processor with WebSocket service
     */
    private async registerMessageProcessor(): Promise<void> {
        try {
            if (!this.messageProcessor) {
                throw new Error('Message processor not initialized');
            }
            
            const wsMessageService = WebSocketMessageService.getInstance();
            wsMessageService.registerMessageProcessor(this.messageProcessor);
            logger.info('[IBCServiceManager] Message processor registered successfully');
        } catch (error) {
            logger.error(`[IBCServiceManager] Failed to register message processor: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Start reconciliation service
     */
    private async startReconciliationService(): Promise<void> {
        try {
            if (!this.reconciliationService || !this.reconciliationService.start) {
                logger.warn('[IBCServiceManager] Reconciliation service not available');
                return;
            }
            
            const intervalMs = this.getReconciliationInterval();
            logger.info(`[IBCServiceManager] Starting reconciliation service with interval ${intervalMs}ms`);
            this.reconciliationService.start(intervalMs);
        } catch (error) {
            logger.error(`[IBCServiceManager] Failed to start reconciliation service: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Process historical blocks for IBC data
     */
    public async processHistoricalBlocks(
        fromHeight?: number,
        blockCount?: number
    ): Promise<void> {
        try {
            if (!this.blockProcessor || !this.stateRepository) {
                throw new Error('Block processor or state repository not initialized');
            }
            
            const currentHeight = await this.babylonClient.getCurrentHeight();
            const lastProcessed = await this.stateRepository.getLastProcessedBlock(this.network);
            
            const startHeight = fromHeight ?? Math.max(lastProcessed + 1, currentHeight - (blockCount ?? 1000));
            const endHeight = Math.min(startHeight + (blockCount ?? 1000), currentHeight);
            
            logger.info(`[IBCServiceManager] Processing historical blocks from ${startHeight} to ${endHeight}`);
            
            for (let height = startHeight; height <= endHeight; height++) {
                await this.blockProcessor.processBlock(height, this.network);
                await this.stateRepository.updateLastProcessedBlock(height, this.network);
                
                if (height % 100 === 0) {
                    logger.info(`[IBCServiceManager] Processed up to block ${height}`);
                }
            }
            
            logger.info(`[IBCServiceManager] Historical processing completed`);
        } catch (error) {
            logger.error(`[IBCServiceManager] Historical processing failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    // Service access methods
    public getChannelService() { return this.channelService; }
    public getConnectionService() { return this.connectionService; }
    public getClientService() { return this.clientService; }
    public getPacketService() { return this.packetService; }
    public getTransferService() { return this.transferService; }
    public getRelayerService() { return this.relayerService; }
    public getStateRepository() { return this.stateRepository; }
    public getBlockProcessor() { return this.blockProcessor; }
    public getReconciliationService() { return this.reconciliationService; }
    public getEventHandler() { return this.eventHandler; }
    public getMessageProcessor() { return this.messageProcessor; }
    public getEventDispatcher() { return this.eventDispatcher; }
    
    // Configuration helpers
    private isReconciliationEnabled(): boolean {
        return process.env.IBC_RECONCILIATION_ENABLED !== 'false';
    }
    
    private getReconciliationInterval(): number {
        const envInterval = process.env.IBC_RECONCILIATION_INTERVAL_MS;
        return envInterval ? parseInt(envInterval) : 10 * 60 * 1000; // 10 minutes default
    }
} 