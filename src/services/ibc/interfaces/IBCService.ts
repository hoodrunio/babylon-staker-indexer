import { Network } from '../../../types/finality';

/**
 * Base interface for all IBC-related services
 */
export interface IBCService {
    /**
     * Process a block for IBC-related data
     * @param height Block height
     * @param network Network to process
     */
    processBlock(height: number, network: Network): Promise<void>;
    
    /**
     * Get the last processed block height
     * @param network Network to check
     */
    getLastProcessedBlock(network: Network): Promise<number>;
    
    /**
     * Update the last processed block height
     * @param height Block height
     * @param network Network to update
     */
    updateLastProcessedBlock(height: number, network: Network): Promise<void>;
}
