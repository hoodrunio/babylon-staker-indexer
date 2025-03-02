/**
 * BBN Staking İşlemi İşleyici Arayüzü
 * Staking işlemlerinin tespiti ve işlenmesi için gerekli metotları tanımlar
 */
export interface IBBNStakingProcessor {
    /**
     * İşlemi kontrol eder ve eğer staking işlemi ise işler
     * @param parsedTx Parse edilmiş işlem
     * @param rawTx Ham işlem verisi
     * @param decodedTx Çözümlenmiş işlem
     */
    processTransactionIfStaking(parsedTx: any, rawTx: any, decodedTx: any): Promise<void>;
} 