/**
 * Batch Transaction İşleme Entegrasyon Örneği
 * 
 * Bu dosya, oluşturduğumuz batch transaction işleme sisteminin 
 * mevcut uygulamaya nasıl entegre edileceğine dair bir örnek sunar.
 */

import axios from 'axios';
import { processBlockTransactions, ProcessedTransaction } from './batchProcessor';

// Uygulama yapılandırması
const config = {
  // Babylon node URL
  nodeUrl: 'https://babylon-testnet-rpc.polkachu.com',
  
  // Batch işleme kullanılsın mı?
  useBatchProcessing: true,
  
  // Her bloktaki maksimum işlem sayısı
  batchSize: 200,
  
  // Hata durumunda yeniden deneme sayısı
  maxRetries: 3
};

/**
 * Örnek uygulama sınıfı
 */
class BabylonIndexer {
  private client: any;
  
  constructor() {
    // API istemcisi
    this.client = axios.create({
      baseURL: config.nodeUrl,
    });
  }
  
  /**
   * Belirli bir bloktaki işlemleri işler
   * @param height Blok yüksekliği
   */
  async processBlockTransactions(height: number): Promise<void> {
    if (config.useBatchProcessing) {
      // Batch işleme kullan
      await this.processBlockTransactionsBatch(height);
    } else {
      // Mevcut TX-by-TX işleme yöntemini kullan
      await this.processBlockTransactionsLegacy(height);
    }
  }
  
  /**
   * Blok işlemlerini toplu olarak işler (yeni yöntem)
   * @param height Blok yüksekliği
   */
  private async processBlockTransactionsBatch(height: number): Promise<void> {
    console.log(`Blok işleniyor: ${height} (batch yöntemi)`);
    
    let retries = 0;
    let success = false;
    
    while (!success && retries < config.maxRetries) {
      try {
        // Bloktaki tüm işlemleri toplu olarak getir ve işle
        const transactions = await processBlockTransactions(
          this.client, 
          height, 
          config.batchSize
        );
        
        // İşlemleri veritabanına kaydet
        await this.saveTransactionsToDB(transactions);
        
        success = true;
        console.log(`Blok ${height}: ${transactions.length} işlem başarıyla işlendi.`);
      } catch (error: unknown) {
        retries++;
        console.error(`Blok ${height} işlenirken hata (deneme ${retries}/${config.maxRetries}):`, error);
        
        // Yeniden denemeden önce kısa bir bekleme süresi
        if (retries < config.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      }
    }
    
    if (!success) {
      console.error(`Blok ${height} işlenemedi, maksimum deneme sayısına ulaşıldı.`);
    }
  }
  
  /**
   * İşlemleri tek tek işler (eski yöntem)
   * @param height Blok yüksekliği
   */
  private async processBlockTransactionsLegacy(height: number): Promise<void> {
    console.log(`Blok işleniyor: ${height} (legacy yöntemi)`);
    
    try {
      // Bu kısım mevcut kodunuzu temsil eder
      // Örnek olarak şu anda yapılan işlemleri burada gerçekleştirirsiniz
      console.log('Mevcut TX-by-TX işleme yöntemi çalıştırılıyor...');
      // ...
    } catch (error) {
      console.error('Legacy işlemede hata:', error);
    }
  }
  
  /**
   * İşlemleri veritabanına kaydeder (örnek)
   * @param transactions İşlenmiş işlemler
   */
  private async saveTransactionsToDB(transactions: ProcessedTransaction[]): Promise<void> {
    console.log(`${transactions.length} işlem veritabanına kaydediliyor...`);
    
    // Bu kısım uygulamanızın veritabanı kayıt mantığını temsil eder
    // Örnek olarak burada bir işlem yapılmamaktadır
    
    // Başarılı ve başarısız işlemleri say
    const successCount = transactions.filter(tx => tx.success).length;
    const failedCount = transactions.filter(tx => !tx.success).length;
    
    console.log(`Veritabanına kayıt tamamlandı:`);
    console.log(`- Başarılı işlemler: ${successCount}`);
    console.log(`- Başarısız işlemler: ${failedCount}`);
  }
}

// Örnek kullanım
async function exampleUsage() {
  const indexer = new BabylonIndexer();
  
  // Örnek bir blok işle
  const blockHeight = 386101;
  await indexer.processBlockTransactions(blockHeight);
}

// Örnek kullanımı çalıştır (gerçek uygulamada bu kısmı kaldırabilirsiniz)
if (require.main === module) {
  exampleUsage().catch(console.error);
} 