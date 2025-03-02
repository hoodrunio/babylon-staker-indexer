import { Network } from '../../../types/finality';
import { BBNTransactionData } from '../../../types/bbn';

/**
 * BBN İşlem Parser Arayüzü
 * İşlemlerin çözümlenmesi ve dönüştürülmesi için gerekli metotları tanımlar
 */
export interface IBBNTransactionParser {
    /**
     * İşlemi parse eder ve standart formata dönüştürür
     * @param transaction İşlem verisi
     * @param msgType İşlem mesaj tipi
     * @param network Ağ bilgisi
     * @returns Dönüştürülmüş işlem verisi
     */
    parseTransaction(transaction: any, msgType: string, network: Network): BBNTransactionData | null;
    
    /**
     * Delege işlemini çözümler
     * @param tx İşlem verisi
     * @param network Ağ bilgisi
     * @returns Çözümlenmiş işlem verisi
     */
    parseDelegateTransaction(tx: any, network: Network): BBNTransactionData | null;
    
    /**
     * Unbonding işlemini çözümler
     * @param tx İşlem verisi
     * @param network Ağ bilgisi
     * @returns Çözümlenmiş işlem verisi
     */
    parseUnbondingTransaction(tx: any, network: Network): BBNTransactionData | null;
    
    /**
     * Transfer işlemini çözümler
     * @param tx İşlem verisi
     * @param network Ağ bilgisi
     * @returns Çözümlenmiş işlem verisi
     */
    parseTransferTransaction(tx: any, network: Network): BBNTransactionData | null;
} 