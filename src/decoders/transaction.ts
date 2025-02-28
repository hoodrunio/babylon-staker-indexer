import { Tx } from '../generated/proto/cosmos/tx/v1beta1/tx';
import { base64ToBytes } from '../utils/base64';
import { decodeAnyMessage } from './messageDecoders';

/**
 * Transaction decoder sonuç tipi
 */
export interface DecodedTx {
  tx: Tx | null;
  messages: Array<{
    typeUrl: string;
    content: any;
    rawValue?: Uint8Array;
  }>;
  rawBytes?: Uint8Array;
  error?: string;
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
    
    return {
      tx,
      messages: decodedMessages,
      rawBytes: txBytes
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Transaction decode hatası:', errorMessage);
    
    return {
      tx: null,
      messages: [],
      rawBytes: txBytes,
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