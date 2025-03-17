import { logger } from '../../../utils/logger';

export class StakerUtils {
    /**
     * Calculates the phase value based on the params version
     * @param paramsVersion Params version
     * @returns Phase value
     */
    public static calculatePhase(paramsVersion?: number): number {
        return (!paramsVersion || paramsVersion < 4) ? 1 : 2;
    }

    /**
     * Formats the txHash value for delegation
     * @param txHash Transaction hash
     * @param stakingTxIdHex Staking transaction ID
     * @returns Formatted txHash
     */
    public static formatTxHash(txHash?: string, stakingTxIdHex?: string): string {
        if (!txHash || !stakingTxIdHex) return '';
        return txHash !== stakingTxIdHex ? txHash : '';
    }

    /**
     * Logs errors
     * @param message Error message
     * @param error Error object
     */
    public static logError(message: string, error: any): void {
        logger.error(`${message}: ${error}`);
    }
}