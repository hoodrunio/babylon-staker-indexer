import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { IMessageProcessor, ISubscription } from './interfaces';
import { BTCDelegationEventHandler } from '../btc-delegations/BTCDelegationEventHandler';
import { WebsocketHealthTracker } from '../btc-delegations/WebsocketHealthTracker';
import { BLSCheckpointService } from '../checkpointing/BLSCheckpointService';
import { CheckpointStatusHandler } from '../checkpointing/CheckpointStatusHandler';
import { ValidatorSignatureService } from '../validator/ValidatorSignatureService';
import { CovenantEventHandler } from '../covenant/CovenantEventHandler';
import { GovernanceEventHandler } from '../governance/GovernanceEventHandler';

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
    constructor(private eventHandler: BTCDelegationEventHandler, private healthTracker: WebsocketHealthTracker) {
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
            await this.healthTracker.updateBlockHeight(network, height);
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
        private validatorSignatureService: ValidatorSignatureService
    ) {
        super();
    }

    canProcess(message: any): boolean {
        return (message?.result?.data?.value?.result_finalize_block && 
                message.id === 'new_block') || 
               (message?.result?.data?.type === 'tendermint/event/NewBlock');
    }

    async process(message: any, network: Network): Promise<void> {
        // Handle checkpoint status updates
        if (message?.result?.data?.value?.result_finalize_block && 
            message.id === 'new_block') {
            await this.checkpointStatusHandler.handleNewBlock(message, network);
        }

        // Handle validator signatures
        if (message?.result?.data?.type === 'tendermint/event/NewBlock') {
            const blockData = message.result.data.value;
            await this.validatorSignatureService.handleNewBlock(blockData, network);
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
    
    private constructor() {
        this.initializeMessageProcessors();
        this.initializeSubscriptions();
    }
    
    public static getInstance(): WebSocketMessageService {
        if (!WebSocketMessageService.instance) {
            WebSocketMessageService.instance = new WebSocketMessageService();
        }
        return WebSocketMessageService.instance;
    }
    
    private initializeMessageProcessors(): void {
        const eventHandler = BTCDelegationEventHandler.getInstance();
        const covenantEventHandler = CovenantEventHandler.getInstance();
        const governanceEventHandler = GovernanceEventHandler.getInstance();
        const healthTracker = WebsocketHealthTracker.getInstance();
        const blsCheckpointService = BLSCheckpointService.getInstance();
        const checkpointStatusHandler = CheckpointStatusHandler.getInstance();
        const validatorSignatureService = ValidatorSignatureService.getInstance();
        
        this.messageProcessors = [
            new BTCStakingMessageProcessor(eventHandler, healthTracker),
            new CovenantMessageProcessor(covenantEventHandler),
            new BLSCheckpointMessageProcessor(blsCheckpointService),
            new NewBlockMessageProcessor(checkpointStatusHandler, validatorSignatureService),
            new GovernanceMessageProcessor(governanceEventHandler)
        ];
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
    
    public async processMessage(message: any, network: Network): Promise<void> {
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