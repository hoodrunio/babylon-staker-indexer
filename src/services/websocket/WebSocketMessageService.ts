import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { IMessageProcessor, ISubscription } from './interfaces';
import { BTCDelegationEventHandler } from '../btc-delegations/BTCDelegationEventHandler';
import { WebsocketHealthTracker } from './WebsocketHealthTracker';
import { BLSCheckpointService } from '../checkpointing/BLSCheckpointService';
import { CheckpointStatusHandler } from '../checkpointing/CheckpointStatusHandler';
import { ValidatorSignatureService } from '../validator/ValidatorSignatureService';
import { CovenantEventHandler } from '../covenant/CovenantEventHandler';
import { GovernanceEventHandler } from '../governance/GovernanceEventHandler';
import { BlockTransactionHandler } from '../block-processor/handlers/BlockTransactionHandler';
import { BlockProcessorModule } from '../block-processor/BlockProcessorModule';

// Subscription implementation
export class Subscription implements ISubscription {
    constructor(
        private id: string,
        private query: string
    ) {}

    getId(): string {
        return this.id;
    }

    getQuery(): string {
        return this.query;
    }
}

// Abstract message processor
export abstract class BaseMessageProcessor implements IMessageProcessor {
    abstract canProcess(message: any): boolean;
    abstract process(message: any, network: Network): Promise<void>;
}

// BTC Staking events processor
export class BTCStakingMessageProcessor extends BaseMessageProcessor {
    constructor(private eventHandler: BTCDelegationEventHandler) {
        super();
    }

    canProcess(message: any): boolean {
        const value = message?.result?.data?.value;
        return value?.TxResult?.result?.events && 
               message.id === 'btc_staking';
    }

    async process(message: any, network: Network): Promise<void> {
        const messageValue = message.result.data.value;
        const height = parseInt(message.result.events['tx.height']?.[0]);
        
        const txData = {
            height,
            hash: message.result.events['tx.hash']?.[0],
            events: messageValue.TxResult.result.events
        };

        if (txData.height && txData.hash && txData.events) {
            await this.eventHandler.handleEvent(txData, network);
        }
    }
}

// Covenant events processor
export class CovenantMessageProcessor extends BaseMessageProcessor {
    constructor(private covenantEventHandler: CovenantEventHandler) {
        super();
    }

    canProcess(message: any): boolean {
        const value = message?.result?.data?.value;
        return value?.TxResult?.result?.events;
    }

    async process(message: any, network: Network): Promise<void> {
        const messageValue = message.result.data.value;
        const height = parseInt(message.result.events['tx.height']?.[0]);
        
        const txData = {
            height,
            hash: message.result.events['tx.hash']?.[0],
            events: messageValue.TxResult.result.events
        };

        if (txData.height && txData.hash && txData.events) {
            await this.covenantEventHandler.handleEvent(txData, network);
        }
    }
}

// BLS Checkpoint processor
export class BLSCheckpointMessageProcessor extends BaseMessageProcessor {
    constructor(private blsCheckpointService: BLSCheckpointService) {
        super();
    }

    canProcess(message: any): boolean {
        const value = message?.result?.data?.value;
        return value?.result_finalize_block && 
               message.id === 'checkpoint_for_bls';
    }

    async process(message: any, network: Network): Promise<void> {
        const messageValue = message.result.data.value;
        await this.blsCheckpointService.handleCheckpoint(
            messageValue.result_finalize_block, 
            network
        );
    }
}

// New Block processor
export class NewBlockMessageProcessor extends BaseMessageProcessor {
    constructor(
        private checkpointStatusHandler: CheckpointStatusHandler,
        private validatorSignatureService: ValidatorSignatureService,
        private blockTransactionHandler: BlockTransactionHandler,
        private healthTracker: WebsocketHealthTracker
    ) {
        super();
    }

    canProcess(message: any): boolean {
        return (message?.result?.data?.value?.result_finalize_block && 
                message.id === 'new_block') || 
               (message?.result?.data?.type === 'tendermint/event/NewBlock');
    }

    async process(message: any, network: Network): Promise<void> {
        const messageResultData = message?.result?.data;

        // Handle messages of type 'tendermint/event/NewBlock'
        // This is the primary event for new block information including height.
        if (messageResultData?.type === 'tendermint/event/NewBlock') {
            const blockData = messageResultData.value; // Contains block header, transactions, etc.

            // Update health tracker with block height as soon as it's available
            if (blockData?.block?.header?.height) {
                const blockHeight = parseInt(blockData.block.header.height);
                await this.healthTracker.updateBlockHeight(network, blockHeight);
            } else {
                // Log a warning if height is unexpectedly missing from a NewBlock event
                logger.warn(`[NewBlockMessageProcessor] Block height not found in 'tendermint/event/NewBlock' data. Message: ${JSON.stringify(message).substring(0, 250)}`);
            }

            // Process validator signatures using the same blockData
            await this.validatorSignatureService.handleNewBlock(blockData, network);

            // Process block transactions using the same blockData
            if (blockData?.block) { // Ensure 'block' field exists for transaction handler
                await this.blockTransactionHandler.handleNewBlock(blockData, network);
            } else {
                logger.warn(`[NewBlockMessageProcessor] Expected 'block' field missing in 'tendermint/event/NewBlock' data for transaction processing. Value: ${JSON.stringify(blockData).substring(0, 250)}`);
            }
        }

        // Separately, handle checkpoint status updates if the message specifically indicates it.
        // This condition comes from the `canProcess` logic:
        // (message?.result?.data?.value?.result_finalize_block && message.id === 'new_block')
        // This might overlap with the 'tendermint/event/NewBlock' type or handle a nuanced case.
        if (messageResultData?.value?.result_finalize_block && message.id === 'new_block') {
            // The checkpointStatusHandler.handleNewBlock expects the full message object.
            await this.checkpointStatusHandler.handleNewBlock(message, network);
        }
    }
}

// Governance events processor
export class GovernanceMessageProcessor extends BaseMessageProcessor {
    constructor(private governanceEventHandler: GovernanceEventHandler) {
        super();
    }

    canProcess(message: any): boolean {
        return message.id === 'governance' && 
               message?.result?.data?.value?.TxResult?.result?.events;
    }

    async process(message: any, network: Network): Promise<void> {
        const messageValue = message.result.data.value;
        const height = parseInt(message.result.events['tx.height']?.[0]);
        
        const txData = {
            height,
            hash: message.result.events['tx.hash']?.[0],
            events: messageValue.TxResult.result.events
        };

        if (txData.height && txData.hash && txData.events) {
            await this.governanceEventHandler.handleEvent(txData, network);
        }
    }
}

// WebSocket Message Service
export class WebSocketMessageService {
    private static instance: WebSocketMessageService | null = null;
    private messageProcessors: IMessageProcessor[] = [];
    private subscriptions: ISubscription[] = [];
    private initialized: boolean = false;
    
    private constructor() {
        this.initializeSubscriptions();
    }
    
    public static getInstance(): WebSocketMessageService {
        if (!WebSocketMessageService.instance) {
            WebSocketMessageService.instance = new WebSocketMessageService();
        }
        return WebSocketMessageService.instance;
    }
    
    private initializeMessageProcessors(): void {
        if (this.initialized) {
            return;
        }
        
        const eventHandler = BTCDelegationEventHandler.getInstance();
        const covenantEventHandler = CovenantEventHandler.getInstance();
        const governanceEventHandler = GovernanceEventHandler.getInstance();
        const healthTracker = WebsocketHealthTracker.getInstance();
        const blsCheckpointService = BLSCheckpointService.getInstance();
        const checkpointStatusHandler = CheckpointStatusHandler.getInstance();
        const validatorSignatureService = ValidatorSignatureService.getInstance();
        
        // Initialize block processing system using BlockProcessorModule
        const blockProcessorModule = BlockProcessorModule.getInstance();
        blockProcessorModule.initialize();
        
        // Get BlockTransactionHandler
        const blockTransactionHandler = blockProcessorModule.getBlockTransactionHandler();
        
        // Get block and transaction processors
        const blockTxProcessors = blockProcessorModule.getMessageProcessors();
        
        logger.info('[WebSocketMessageService] Block processor system initialized successfully');
        
        this.messageProcessors = [
            new BTCStakingMessageProcessor(eventHandler),
            new CovenantMessageProcessor(covenantEventHandler),
            new BLSCheckpointMessageProcessor(blsCheckpointService),
            new NewBlockMessageProcessor(checkpointStatusHandler, validatorSignatureService, blockTransactionHandler, healthTracker),
            new GovernanceMessageProcessor(governanceEventHandler),
            // Add block and transaction processors
            ...blockTxProcessors
        ];
        
        this.initialized = true;
    }
    
    private initializeSubscriptions(): void {
        this.subscriptions = [
            new Subscription('btc_staking', "tm.event='Tx' AND message.module='btcstaking'"),
            new Subscription('new_block', "tm.event='NewBlock'"),
            new Subscription('new_tx', "tm.event='Tx'"),
            new Subscription('checkpoint_for_bls', "tm.event='NewBlock' AND babylon.checkpointing.v1.EventCheckpointSealed.checkpoint CONTAINS 'epoch_num'"),
            new Subscription('governance', "tm.event='Tx' AND message.module='gov'")
        ];
    }
    
    public getSubscriptions(): ISubscription[] {
        return this.subscriptions;
    }
    
    /**
     * Register a message processor dynamically
     * This allows modules to add their processors without modifying this service
     * @param processor Message processor to register
     */
    public registerMessageProcessor(processor: IMessageProcessor): void {
        // Initialize message processors first if not already done
        if (!this.initialized) {
            this.initializeMessageProcessors();
        }
        
        // Add the processor if it doesn't already exist
        const exists = this.messageProcessors.some(existingProcessor => 
            existingProcessor.constructor.name === processor.constructor.name);
            
        if (!exists) {
            this.messageProcessors.push(processor);
            logger.info(`[WebSocketMessageService] Registered message processor: ${processor.constructor.name}`);
        } else {
            logger.warn(`[WebSocketMessageService] Message processor already registered: ${processor.constructor.name}`);
        }
    }
    
    public async processMessage(message: any, network: Network): Promise<void> {
        // Initialize message processors before processing the first message
        if (!this.initialized) {
            this.initializeMessageProcessors();
        }
        
        try {
            // Check if this is a subscription confirmation message
            if (message.result && !message.result.data) {
                logger.info(`${network} subscription confirmed:`, message);
                return;
            }

            // Process message with appropriate processors
            const processPromises: Promise<void>[] = [];
            
            for (const processor of this.messageProcessors) {
                if (processor.canProcess(message)) {
                    processPromises.push(processor.process(message, network));
                }
            }

            // Wait for all processes to complete
            if (processPromises.length > 0) {
                await Promise.all(processPromises);
            } else {
                logger.info(`${network} received unhandled message type:`, message);
            }
        } catch (error) {
            logger.error(`Error handling ${network} websocket message:`, error);
        }
    }
} 