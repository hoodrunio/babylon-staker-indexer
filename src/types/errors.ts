import { CustomError } from '../clients/BaseClient';

export class FutureBlockError implements CustomError {
    public readonly name: string = 'FutureBlockError';
    public readonly message: string;
    public originalError?: any;
    public details: {
        targetHeight: number;
        currentHeight: number;
        blockDifference: number;
        estimatedTimeMs?: number;
        estimatedSeconds?: number;
    };
    
    constructor(
        targetHeight: number, 
        currentHeight: number, 
        originalError?: any,
        estimatedTimeMs?: number,
        estimatedSeconds?: number
    ) {
        this.details = {
            targetHeight,
            currentHeight,
            blockDifference: targetHeight - currentHeight,
            estimatedTimeMs,
            estimatedSeconds
        };
        
        this.message = `Block height ${targetHeight} is not available yet. Current height is ${currentHeight}. Estimated time until block creation: ${estimatedSeconds ? Math.ceil(estimatedSeconds) + ' seconds' : 'unknown'}`;
        this.originalError = originalError;
    }
} 