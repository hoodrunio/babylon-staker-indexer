import { Network } from '../../../types/finality';

/**
 * BBN Stake İndeksleyici Arayüzü
 * Staking işlemlerinin takip edilmesi ve işlenmesi için gerekli metotları tanımlar
 */
export interface IBBNStakeIndexer {
    /**
     * İndekslemeyi başlatır
     */
    start(): Promise<void>;
    
    /**
     * İndekslemeyi durdurur
     */
    stop(): void;
    
    /**
     * Delegasyon işlemini işler
     * @param tx İşlem verisi
     */
    processDelegateTransaction(tx: any): Promise<void>;
    
    /**
     * Unbonding işlemini işler
     * @param tx İşlem verisi
     */
    processUnbondingTransaction(tx: any): Promise<void>;
    
    /**
     * Kullanıcının staking istatistiklerini getirir
     * @param address Kullanıcı adresi
     */
    getUserStakingStats(address: string): Promise<any>;
    
    /**
     * Validatör bazlı stake miktarlarını getirir
     */
    getValidatorStakesStats(): Promise<any>;
} 