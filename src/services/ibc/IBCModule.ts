import { logger } from '../../utils/logger';
import { WebSocketMessageService, BaseMessageProcessor } from '../websocket/WebSocketMessageService';
import { IBCEventHandler } from './IBCEventHandler';
import { IBCMessageProcessor } from './IBCMessageProcessor';
import { IBCStateRepository } from './repository/IBCStateRepository';

/**
 * Main module for the IBC indexer system
 * Integrates with the existing websocket architecture
 * Creates a self-contained module that can be initialized from the main application
 */
export class IBCModule {
    private static instance: IBCModule | null = null;
    private ibcEventHandler: IBCEventHandler;
    private ibcMessageProcessor: IBCMessageProcessor;
    private stateRepository: IBCStateRepository;
    private initialized: boolean = false;

    private constructor() {
        // Initialize services
        this.ibcEventHandler = IBCEventHandler.getInstance();
        this.ibcMessageProcessor = new IBCMessageProcessor(this.ibcEventHandler);
        this.stateRepository = new IBCStateRepository();
    }

    public static getInstance(): IBCModule {
        if (!IBCModule.instance) {
            IBCModule.instance = new IBCModule();
        }
        return IBCModule.instance;
    }

    /**
     * Initialize the IBC Module
     * Registers message processor with WebSocketMessageService
     */
    public initialize(): void {
        if (this.initialized) {
            logger.warn('[IBCModule] Already initialized');
            return;
        }

        logger.info('[IBCModule] Initializing IBC module');

        try {
            // Register IBC message processor to handle messages from existing subscriptions
            this.registerMessageProcessor();
            
            this.initialized = true;
            logger.info('[IBCModule] IBC module initialized successfully');
        } catch (error) {
            logger.error(`[IBCModule] Error initializing IBC module: ${error instanceof Error ? error.message : String(error)}`);
        }
    }



    /**
     * Register the IBC message processor
     * This allows the system to handle IBC-related events from the websocket
     * Will leverage the existing 'new_tx' subscription
     */
    private registerMessageProcessor(): void {
        try {
            // Get WebSocketMessageService instance
            const wsMessageService = WebSocketMessageService.getInstance();
            
            // Register the IBC message processor
            wsMessageService.registerMessageProcessor(this.ibcMessageProcessor);
            
            logger.info('[IBCModule] IBC message processor registered successfully');
        } catch (error) {
            logger.error(`[IBCModule] Error registering IBC message processor: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get the IBC message processor
     * This allows other systems to use our processor if needed
     */
    public getMessageProcessor(): BaseMessageProcessor {
        return this.ibcMessageProcessor;
    }

    /**
     * Get the state repository
     * This is used to query indexer state information
     */
    public getStateRepository(): IBCStateRepository {
        return this.stateRepository;
    }
}
