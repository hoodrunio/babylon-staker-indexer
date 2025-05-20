import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import { IndexerState as IndexerStateModel } from '../../../database/models/IndexerState';

/**
 * Repository for managing IBC indexer state
 * Tracks last processed blocks and other state information
 */
export class IBCStateRepository {
    // Keys for state entries
    private readonly IBC_LAST_BLOCK_KEY = 'ibc_last_processed_block';

    /**
     * Get the last processed block height for IBC indexing
     * @param network Network to check
     */
    public async getLastProcessedBlock(network: Network): Promise<number> {
        try {
            // Find the indexer state document for IBC processing
            const indexerState = await IndexerStateModel.findOne({
                _id: `${this.IBC_LAST_BLOCK_KEY}_${network.toString()}`
            });
            
            // If no state exists, return default value or from env
            if (!indexerState) {
                const defaultHeight = parseInt(process.env.IBC_SYNC_FROM_HEIGHT || '0');
                return defaultHeight;
            }
            
            return indexerState.lastProcessedBlock;
        } catch (error) {
            logger.error(`[IBCStateRepository] Error getting last processed block: ${error instanceof Error ? error.message : String(error)}`);
            
            // Return default value on error
            return parseInt(process.env.IBC_SYNC_FROM_HEIGHT || '0');
        }
    }

    /**
     * Update the last processed block height for IBC indexing
     * @param height Block height
     * @param network Network to update
     */
    public async updateLastProcessedBlock(height: number, network: Network): Promise<void> {
        try {
            // Use upsert to create document if it doesn't exist
            await IndexerStateModel.updateOne(
                {
                    _id: `${this.IBC_LAST_BLOCK_KEY}_${network.toString()}`
                },
                {
                    $set: {
                        lastProcessedBlock: height,
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );
            
            logger.debug(`[IBCStateRepository] Updated IBC last processed block to ${height} for ${network}`);
        } catch (error: any) {
            logger.error(`[IBCStateRepository] Error updating last processed block: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get state entry by key
     * @param key State key
     * @param network Network
     */
    public async getStateEntry(key: string, network: Network): Promise<any> {
        try {
            const state = await IndexerStateModel.findOne({
                indexer_name: key,
                network: network.toString()
            });
            
            return state;
        } catch (error) {
            logger.error(`[IBCStateRepository] Error getting state entry ${key}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Set state entry value
     * @param key State key
     * @param value State value (will be stored in data field)
     * @param network Network
     */
    public async setStateEntry(key: string, value: any, network: Network): Promise<void> {
        try {
            await IndexerStateModel.updateOne(
                {
                    indexer_name: key,
                    network: network.toString()
                },
                {
                    $set: {
                        data: value,
                        updated_at: new Date()
                    }
                },
                { upsert: true }
            );
        } catch (error) {
            logger.error(`[IBCStateRepository] Error setting state entry ${key}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
