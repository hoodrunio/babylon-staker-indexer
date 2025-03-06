/**
 * Veri sıkıştırma yardımcı fonksiyonları
 */
import zlib from 'zlib';
import { logger } from './logger';

/**
 * Veriyi sıkıştırır ve base64 formatında döndürür
 * @param data Sıkıştırılacak veri
 * @returns Sıkıştırılmış ve base64 formatında kodlanmış veri
 */
export function compressData(data: any): string {
  try {
    // Veriyi JSON string'e dönüştür
    const jsonString = JSON.stringify(data);
    
    // Veriyi sıkıştır (gzip)
    const compressed = zlib.gzipSync(Buffer.from(jsonString, 'utf-8'));
    
    // Base64 formatına dönüştür
    return compressed.toString('base64');
  } catch (error) {
    logger.error(`Veri sıkıştırma hatası: ${error instanceof Error ? error.message : String(error)}`);
    // Hata durumunda orijinal veriyi JSON string olarak döndür
    return JSON.stringify(data);
  }
}

/**
 * Sıkıştırılmış veriyi açar ve JavaScript nesnesine dönüştürür
 * @param compressedData Sıkıştırılmış ve base64 formatında kodlanmış veri
 * @returns Açılmış JavaScript nesnesi
 */
export function decompressData(compressedData: string): any {
  try {
    // Base64'ten buffer'a dönüştür
    const buffer = Buffer.from(compressedData, 'base64');
    
    // Sıkıştırmayı aç
    const decompressed = zlib.gunzipSync(buffer);
    
    // JSON parse ile JavaScript nesnesine dönüştür
    return JSON.parse(decompressed.toString('utf-8'));
  } catch (error) {
    logger.error(`Veri açma hatası: ${error instanceof Error ? error.message : String(error)}`);
    
    // Belki sıkıştırılmamış bir JSON string'dir, doğrudan parse etmeyi dene
    try {
      return JSON.parse(compressedData);
    } catch {
      // Hiçbir şekilde parse edilemiyorsa boş dizi döndür
      return [];
    }
  }
} 