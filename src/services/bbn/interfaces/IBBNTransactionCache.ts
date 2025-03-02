import { BBNTransactionData } from '../../../types/bbn';

/**
 * BBN İşlem Cache Arayüzü
 * İşlemlerin önbellekte saklanması ve erişilmesi için gerekli metotları tanımlar
 */
export interface IBBNTransactionCache {
    /**
     * İşlem verisini önbelleğe ekler
     * @param txData İşlem verisi
     */
    updateTransactionCache(txData: BBNTransactionData): Promise<void>;
    
    /**
     * Adrese ait işlemleri önbellekten getirir
     * @param address Adres
     * @returns İşlem listesi
     */
    getAddressTransactions(address: string): Promise<BBNTransactionData[]>;
    
    /**
     * Son işlemleri önbellekten getirir
     * @returns İşlem listesi
     */
    getRecentTransactions(): Promise<BBNTransactionData[]>;
    
    /**
     * Adrese ait önbelleği temizler
     * @param address Adres
     */
    clearAddressCache(address: string): Promise<void>;
    
    /**
     * Tüm önbellekleri temizler
     */
    clearAllCaches(): Promise<void>;
} 