import { Request, Response, NextFunction } from 'express';
import { FutureBlockError } from '../types/errors';
import { logger } from '../utils/logger';

/**
 * Generic error handler for API routes
 * Transforms errors into appropriate HTTP responses
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
    if (err instanceof FutureBlockError) {
        // Handle future block errors with a 404 status but with helpful information
        const { targetHeight, currentHeight, blockDifference, estimatedSeconds } = err.details;
        
        return res.status(404).json({
            status: 'future_block',
            error: 'Block not found yet',
            message: err.message,
            data: {
                requestedHeight: targetHeight,
                currentHeight: currentHeight,
                blockDifference: blockDifference,
                estimatedTimeSeconds: estimatedSeconds ? Math.ceil(estimatedSeconds) : null,
                estimatedTimeFormatted: estimatedSeconds ? formatTimeEstimate(estimatedSeconds) : 'unknown'
            }
        });
    }
    
    // Transaction not found error
    if (err.name === 'TxNotFoundError') {
        return res.status(404).json({
            status: 'error',
            error: 'Transaction not found',
            message: 'The requested transaction could not be found'
        });
    }
    
    // General errors
    const errorMessage = err.message || (typeof err === 'string' ? err : 'Unknown error');
    const stackTrace = err.stack ? `\nStack: ${err.stack}` : '';
    logger.error(`[API Error] ${errorMessage}${stackTrace}`);
    
    return res.status(500).json({
        status: 'error',
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production' 
            ? 'An unexpected error occurred' 
            : (err.message || 'Unknown error')
    });
}

/**
 * Formats time in seconds into a human-readable string
 * @param seconds Time in seconds
 * @returns Formatted time string
 */
function formatTimeEstimate(seconds: number): string {
    if (seconds < 60) {
        return `about ${Math.ceil(seconds)} seconds`;
    } else if (seconds < 3600) {
        const minutes = Math.ceil(seconds / 60);
        return `about ${minutes} minutes`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.ceil((seconds % 3600) / 60);
        return `about ${hours} hours ${minutes > 0 ? `${minutes} minutes` : ''}`;
    }
}