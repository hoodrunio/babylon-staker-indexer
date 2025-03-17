import { logger } from '../../../utils/logger';

export class StakerUtils {
    /**
     * Params version'a göre phase değerini hesaplar
     * @param paramsVersion Params version
     * @returns Phase değeri
     */
    public static calculatePhase(paramsVersion?: number): number {
        return (!paramsVersion || paramsVersion < 4) ? 1 : 2;
    }

    /**
     * Delegasyon için txHash değerini düzenler
     * @param txHash Transaction hash
     * @param stakingTxIdHex Staking transaction ID
     * @returns Düzenlenmiş txHash
     */
    public static formatTxHash(txHash?: string, stakingTxIdHex?: string): string {
        if (!txHash || !stakingTxIdHex) return '';
        return txHash !== stakingTxIdHex ? txHash : '';
    }

    /**
     * Hata durumunda loglama yapar
     * @param message Hata mesajı
     * @param error Hata objesi
     */
    public static logError(message: string, error: any): void {
        logger.error(`${message}: ${error}`);
    }
} 