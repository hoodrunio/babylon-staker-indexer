import { Network } from '../../types/finality';
import { BBNTransactionData } from '../../types/bbn';
import { logger } from '../../utils/logger';
import { CacheService } from '../CacheService';
import { IBBNTransactionCache } from './interfaces/IBBNTransactionCache';

/**
 * BBN İşlem Cache Yönetimi Sınıfı
 * Son işlemleri ve adrese göre işlemleri önbellekte tutmak için kullanılır
 */
export class BBNTransactionCache implements IBBNTransactionCache {
    private static instance: BBNTransactionCache | null = null;
    private readonly network: Network;
    private cacheService: CacheService;
    
    private constructor(network: Network = Network.MAINNET) {
        this.network = network;
        this.cacheService = CacheService.getInstance();
    }
    
    public static getInstance(network: Network = Network.MAINNET): BBNTransactionCache {
        if (!BBNTransactionCache.instance) {
            BBNTransactionCache.instance = new BBNTransactionCache(network);
        }
        return BBNTransactionCache.instance;
    }
    
    /**
     * Updates transaction cache
     * @param txData Transaction data to add to cache
     */
    public async updateTransactionCache(txData: BBNTransactionData): Promise<void> {
        try {
            // Son 100 işlemi cache'de tut
            const cacheKey = `bbn_recent_transactions_${this.network}`;
            const cachedData = await this.cacheService.get(cacheKey);
            
            // Geçerli bir dizi oluştur
            const transactions: BBNTransactionData[] = Array.isArray(cachedData) ? cachedData : [];
            
            // Yeni işlemi ekle
            transactions.unshift(txData);
            
            // Cache'i 100 işlemle sınırla
            if (transactions.length > 100) {
                transactions.pop();
            }
            
            // Cache'i güncelle
            await this.cacheService.set(cacheKey, transactions, 3600); // 1 saat cache süresi
            
            // Adres bazlı cache güncelleme
            if (txData.sender) {
                await this.updateAddressTransactionCache(txData.sender, txData);
            }
            
            if (txData.receiver && txData.receiver !== txData.sender) {
                await this.updateAddressTransactionCache(txData.receiver, txData);
            }
        } catch (error) {
            logger.error(`Error updating transaction cache for ${txData.txHash}:`, error);
        }
    }

    /**
     * Updates address-specific transaction cache
     * @param address Account address
     * @param txData Transaction data
     */
    private async updateAddressTransactionCache(address: string, txData: BBNTransactionData): Promise<void> {
        try {
            const cacheKey = `bbn_address_txs_${address}_${this.network}`;
            const cachedData = await this.cacheService.get(cacheKey);
            
            // Geçerli bir dizi oluştur
            const transactions: BBNTransactionData[] = Array.isArray(cachedData) ? cachedData : [];
            
            // İşlemi ekle
            transactions.unshift(txData);
            
            // Cache'i 50 işlemle sınırla
            if (transactions.length > 50) {
                transactions.pop();
            }
            
            // Cache'i güncelle
            await this.cacheService.set(cacheKey, transactions, 3600); // 1 saat cache süresi
        } catch (error) {
            logger.error(`Error updating address transaction cache for ${address}:`, error);
        }
    }
    
    /**
     * Get cached transactions for an address
     * @param address Address to get transactions for
     * @returns Array of transactions or empty array if none found
     */
    public async getAddressTransactions(address: string): Promise<BBNTransactionData[]> {
        try {
            const cacheKey = `bbn_address_txs_${address}_${this.network}`;
            const cachedData = await this.cacheService.get(cacheKey);
            
            if (!cachedData || !Array.isArray(cachedData)) {
                return [];
            }
            
            return cachedData;
        } catch (error) {
            logger.error(`Error getting address transactions from cache for ${address}:`, error);
            return [];
        }
    }
    
    /**
     * Get recent transactions from cache
     * @returns Array of recent transactions or empty array if none found
     */
    public async getRecentTransactions(): Promise<BBNTransactionData[]> {
        try {
            const cacheKey = `bbn_recent_transactions_${this.network}`;
            const cachedData = await this.cacheService.get(cacheKey);
            
            if (!cachedData || !Array.isArray(cachedData)) {
                return [];
            }
            
            return cachedData;
        } catch (error) {
            logger.error(`Error getting recent transactions from cache:`, error);
            return [];
        }
    }
    
    /**
     * Clear transaction cache for an address
     * @param address Address to clear cache for
     */
    public async clearAddressCache(address: string): Promise<void> {
        try {
            const cacheKey = `bbn_address_txs_${address}_${this.network}`;
            await this.cacheService.del(cacheKey);
            logger.debug(`Cleared transaction cache for address: ${address}`);
        } catch (error) {
            logger.error(`Error clearing address transaction cache for ${address}:`, error);
        }
    }
    
    /**
     * Clear all transaction caches
     */
    public async clearAllCaches(): Promise<void> {
        try {
            // Recent transactions cache temizle
            await this.cacheService.del(`bbn_recent_transactions_${this.network}`);
            
            // Not: Adres bazlı cache'leri temizlemek daha karmaşık olabilir
            // Burada tüm adres cache'lerini taramak ve silmek gerekebilir
            // Bunun için CacheService'de özel bir metot gerekebilir
            
            logger.debug(`Cleared all transaction caches for network: ${this.network}`);
        } catch (error) {
            logger.error(`Error clearing all transaction caches:`, error);
        }
    }
} 