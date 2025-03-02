import { Network } from '../../../types/finality';
import { BBNTransactionType, BBNTransactionData } from '../../../types/bbn';

/**
 * BBN İşlem İndeksleyici Arayüzü
 * İşlemlerin zincirden takibi ve indexlenmesi için gerekli metotları tanımlar
 */
export interface IBBNTransactionIndexer {
    /**
     * İndekslemeyi başlatır
     */
    start(): Promise<void>;
    
    /**
     * İndekslemeyi durdurur
     */
    stop(): void;
    
    /**
     * Belirli bir bloğu işler
     * @param height Blok yüksekliği
     */
    processBlock(height: number): Promise<void>;
    
    /**
     * İşlemi işler ve veritabanına kaydeder
     * @param txData İşlem verisi
     */
    processTransaction(txData: BBNTransactionData): Promise<void>;
    
    /**
     * İşlemleri getirir
     * @param options Filtreleme seçenekleri
     */
    getTransactions(options?: {
        network?: Network,
        address?: string,
        type?: BBNTransactionType,
        startTime?: number,
        endTime?: number,
        page?: number,
        limit?: number
    }): Promise<{
        transactions: any[],
        total: number,
        page: number,
        totalPages: number
    }>;
} 