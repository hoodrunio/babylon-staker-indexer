import { Network } from '../../../types/finality';

/**
 * Event context containing metadata for IBC events
 */
export interface EventContext {
    height: number;
    txHash: string;
    timestamp: Date;
    network: Network;
}

/**
 * Interface for IBC event processors
 */
export interface IBCEventProcessor {
    /**
     * Process events from a transaction
     * @param events Array of events from transaction
     * @param context Context information about the transaction
     */
    processEvents(events: any[], context: EventContext): Promise<void>;
    
    /**
     * Check if an event is of interest to this processor
     * @param event Event to check
     */
    canProcess(event: any): boolean;
}
