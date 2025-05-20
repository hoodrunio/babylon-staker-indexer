import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IBCEventHandler } from '../IBCEventHandler';
import { EventContext } from '../interfaces/IBCEventProcessor';

/**
 * Dispatches IBC events to appropriate handlers
 * This acts as an intermediary between block processing and event handling
 */
export class IBCEventDispatcher {
    private eventHandler: IBCEventHandler;

    constructor() {
        this.eventHandler = IBCEventHandler.getInstance();
        logger.info('[IBCEventDispatcher] Initialized');
    }

    /**
     * Dispatch IBC event data from a transaction to appropriate handlers
     * @param txData Transaction data containing IBC events
     * @param context Context information about the event (height, timestamp, etc.)
     * @param network Network where the event occurred
     */
    public async dispatchEvents(
        txData: any,
        context: EventContext,
        network: Network
    ): Promise<void> {
        try {
            // Map the transaction data to the format expected by the IBCEventHandler
            const ibcTxData = {
                height: context.height,
                hash: txData.hash || '',
                events: txData.events || []
            };

            // Forward to the event handler
            await this.eventHandler.handleEvent(ibcTxData, network);
        } catch (error) {
            logger.error(`[IBCEventDispatcher] Error dispatching events: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
