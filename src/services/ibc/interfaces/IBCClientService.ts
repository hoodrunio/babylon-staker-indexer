import { Network } from '../../../types/finality';

/**
 * Interface for IBC client service
 */
export interface IBCClientService {
    /**
     * Process a client-related event
     * @param event Event data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Block timestamp
     * @param network Network where the event occurred
     */
    processClientEvent(
        event: any, 
        txHash: string,
        height: number, 
        timestamp: Date,
        network: Network
    ): Promise<void>;
}
