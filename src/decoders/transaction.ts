import { Tx } from '../generated/proto/cosmos/tx/v1beta1/tx';
import { base64ToBytes } from '../utils/base64';
import { decodeAnyMessage, convertBuffersToHex } from './messageDecoders';

/**
 * Transaction decoder sonuç tipi
 */
export interface DecodedTx {
  tx?: Tx | null;
  messages: Array<{
    typeUrl: string;
    content: any;
    rawValue?: Uint8Array;
  }>;
  rawBytes?: Uint8Array;
  error?: string;
}

/**
 * Long tipindeki değerleri normal JavaScript sayılarına veya BigInt'e dönüştürür
 * @param longObj Long tipindeki değer 
 * @returns Normal sayıya dönüştürülmüş değer
 */
export function longToNumber(longObj: any): number | bigint | any {
  if (!longObj || typeof longObj !== 'object') return longObj;
  
  if ('low' in longObj && 'high' in longObj && 'unsigned' in longObj) {
    // Eğer high değeri 0 ise, değer 32-bit sınırları içinde, doğrudan low değerini kullanabiliriz
    if (longObj.high === 0) {
      return longObj.unsigned ? longObj.low >>> 0 : longObj.low;
    }
    
    // JavaScript'in sayı sınırlarını aşma ihtimali varsa, BigInt kullan
    try {
      if (typeof BigInt !== 'undefined') {
        const value = (BigInt(longObj.high) << BigInt(32)) | BigInt(longObj.low >>> 0);
        // String olarak döndürmek daha güvenli, çünkü BigInt doğrudan JSON'a dönüştürülemez
        return longObj.unsigned || value >= 0n ? value.toString() : value.toString();
      }
    } catch {
      // BigInt yoksa veya çalışmazsa, normal JavaScript sayıları kullan
    }
    
    // Fallback: 32-bit'lik değerleri bitwise işlemlerle birleştir
    const result = longObj.high * 4294967296 + (longObj.low >>> 0);
    return longObj.unsigned || result >= 0 ? result : result - 4294967296 * 2;
  }
  
  return longObj;
}

/**
 * Nesnelerdeki tüm Long değerlerini normal JavaScript değerlerine dönüştürür
 * @param obj Long değerleri içerebilecek herhangi bir nesne
 * @returns Long değerleri dönüştürülmüş nesne
 */
export function convertLongValues(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => convertLongValues(item));
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && 'low' in value && 'high' in value && 'unsigned' in value) {
        result[key] = longToNumber(value);
      } else if (value && typeof value === 'object') {
        result[key] = convertLongValues(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * Base64 formatındaki bir transaction'ı decode eder
 * @param txBase64 Base64 formatındaki işlem verisi
 * @returns Decoded transaction ve mesaj içeriği
 */
export function decodeTx(txBase64: string): DecodedTx {
  // Base64'ten binary'e dönüştürme
  const txBytes = base64ToBytes(txBase64);
  
  try {
    // TX'i decode etme
    const tx = Tx.decode(txBytes);
    
    // Mesajları decode etme
    const decodedMessages = tx.body?.messages.map(msg => {
      return decodeAnyMessage(msg);
    }) || [];
    
    // Bufferları hex'e ve Long değerleri normal değerlere dönüştür
   // const processedTx = convertLongValues(convertBuffersToHex(tx)) as any;
    const processedMessages = convertLongValues(decodedMessages);
    
    return {
      // tx: processedTx,
      messages: processedMessages,
      //rawBytes: txBytes
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Transaction decode hatası:', errorMessage);
    
    return {
      // tx: null,
      messages: [],
      //rawBytes: txBytes,
      error: `İşlem decode edilemedi: ${errorMessage}`
    };
  }
}

/**
 * İşlem sonucundaki olayları işler
 * @param events İşlem sonucundaki olaylar
 * @returns İşlenmiş olaylar
 */
export function processEvents(events: any[] = []): Record<string, any[]> {
  const processedEvents: Record<string, any[]> = {};
  
  for (const event of events) {
    const eventType = event.type;
    
    if (!processedEvents[eventType]) {
      processedEvents[eventType] = [];
    }
    
    const attributes = event.attributes || [];
    const processedAttributes: Record<string, string> = {};
    
    for (const attr of attributes) {
      const key = attr.key;
      const value = attr.value;
      
      if (key && value) {
        processedAttributes[key] = value;
      }
    }
    
    processedEvents[eventType].push(processedAttributes);
  }
  
  return processedEvents;
} 