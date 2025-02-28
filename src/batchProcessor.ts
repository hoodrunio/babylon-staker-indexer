import { decodeTx, processEvents } from './decoders';

/**
 * İşleme sonrası transaction bilgisi
 */
export interface ProcessedTransaction {
  hash: string;
  height: string;
  index: number;
  success: boolean;
  gasUsed: string;
  gasWanted: string;
  decodedTx: any;
  messages: any[];
  events: Record<string, any[]>;
  error?: string;
  rawTx?: any;
}

/**
 * Bir bloktaki tüm işlemleri işler
 * @param blockTxs Blok işlemleri listesi
 * @returns İşlenmiş işlem listesi
 */
export async function processBatchTransactions(blockTxs: any[]): Promise<ProcessedTransaction[]> {
  const processedTxs: ProcessedTransaction[] = [];
  
  for (const txInfo of blockTxs) {
    try {
      // TX base64 verisi
      const txBase64 = txInfo.tx;
      if (!txBase64) {
        throw new Error('İşlem verisi bulunamadı');
      }
      
      // TX'i decode et
      const { tx, messages, error } = decodeTx(txBase64);
      
      if (error) {
        throw new Error(error);
      }
      
      // İşlem sonucunu işle
      const result: ProcessedTransaction = {
        hash: txInfo.hash,
        height: txInfo.height,
        index: txInfo.index || 0,
        success: txInfo.tx_result?.code === 0,
        gasUsed: txInfo.tx_result?.gas_used || '0',
        gasWanted: txInfo.tx_result?.gas_wanted || '0',
        decodedTx: tx,
        messages,
        events: processEvents(txInfo.tx_result?.events || [])
      };
      
      processedTxs.push(result);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`İşlem işlenirken hata: ${txInfo.hash || 'bilinmeyen'}`, errorMessage);
      
      // Hata durumunda bile işlemi listeye eklemek için
      processedTxs.push({
        hash: txInfo.hash || '',
        height: txInfo.height || '',
        index: txInfo.index || 0,
        success: false,
        gasUsed: '0',
        gasWanted: '0',
        decodedTx: null,
        messages: [],
        events: {},
        error: errorMessage,
        rawTx: txInfo
      });
    }
  }
  
  return processedTxs;
}

/**
 * Belirli bir bloktaki işlemleri toplu olarak getirir ve işler
 * @param client API istemcisi
 * @param height Blok yüksekliği
 * @param limit Sayfalama limiti
 * @returns İşlenmiş işlem listesi
 */
export async function processBlockTransactions(
  client: any,
  height: number,
  limit: number = 200
): Promise<ProcessedTransaction[]> {
  try {
    // Blok işlemlerini toplu olarak getir
    const response = await client.get(`cosmos/tx/v1beta1/txs/block/${height}?pagination.limit=${limit}`);
    const blockTxs = response.data?.txs || [];
    
    if (blockTxs.length === 0) {
      console.log(`Blok ${height} için işlem bulunamadı`);
      return [];
    }
    
    console.log(`Blok ${height} için ${blockTxs.length} işlem bulundu, işleniyor...`);
    
    // TX'leri işle
    const processedTxs = await processBatchTransactions(blockTxs);
    
    return processedTxs;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Blok işlemleri getirilirken hata: ${height}`, errorMessage);
    throw error;
  }
} 