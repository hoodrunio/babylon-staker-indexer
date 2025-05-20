import { Network } from '../../../types/finality';

/**
 * Interface for IBC connection service
 */
export interface IBCConnectionService {
    /**
     * Process a connection-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    processConnectionEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void>;
}
