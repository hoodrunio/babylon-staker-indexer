import { BlockTimeService } from '../services/BlockTimeService';
import { FutureBlockError } from '../types/errors';
import { Network } from '../types/finality';
import { CustomError } from '../clients/BaseClient';
import { logger } from './logger';

/**
 * Checks if an error is related to a future block that doesn't exist yet
 * If it is a future block error, enriches it with estimated time information
 * @param error Original error
 * @param network Network to use for block time estimates
 * @returns Enhanced FutureBlockError or the original error
 */
export async function handleFutureBlockError(error: any, network: Network): Promise<Error> {
    // Check if this is a HeightNotAvailableError with specific details about target and current height
    if (error?.name === 'HeightNotAvailableError' && error?.details?.targetHeight && error?.details?.currentBlockchainHeight) {
        try {
            const { targetHeight, currentBlockchainHeight } = error.details;
            
            // Only process if this is truly a future block (target > current)
            if (targetHeight > currentBlockchainHeight) {
                // Get block time service instance
                const blockTimeService = BlockTimeService.getInstance(network);
                
                // Calculate estimated time
                const estimate = await blockTimeService.getEstimatedTimeToBlock(targetHeight);
                
                // Create enhanced error
                return new FutureBlockError(
                    targetHeight,
                    currentBlockchainHeight,
                    error.originalError,
                    estimate.estimatedTimeMs || undefined,
                    estimate.estimatedSeconds || undefined
                );
            }
        } catch (estimateError) {
            logger.error(`[FutureBlockHelper] Error estimating time for future block: ${estimateError instanceof Error ? estimateError.message : String(estimateError)}`);
            // Continue with original error if estimation fails
        }
    }
    
    // Return the original error if not a future block error or if estimation fails
    return error;
} 