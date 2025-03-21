import { Tx } from '../../generated/proto/cosmos/tx/v1beta1/tx';
import { base64ToBytes } from '../../utils/base64';
import { decodeAnyMessage, convertBuffersToHex } from './messageDecoders';

/**
 * Transaction decoder result type
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
 * Converts Long type values to normal JavaScript numbers or BigInt
 * @param longObj Value in Long type
 * @returns Converted value to normal number
 */
export function longToNumber(longObj: any): number | bigint | any {
  if (!longObj || typeof longObj !== 'object') return longObj;
  
  if ('low' in longObj && 'high' in longObj && 'unsigned' in longObj) {
    // If the high value is 0, the value is within 32-bit limits, we can directly use the low value
    if (longObj.high === 0) {
      return longObj.unsigned ? longObj.low >>> 0 : longObj.low;
    }
    
    // Use BigInt if there is a possibility of exceeding JavaScript's number limits
    try {
      if (typeof BigInt !== 'undefined') {
        const value = (BigInt(longObj.high) << BigInt(32)) | BigInt(longObj.low >>> 0);
        // It is safer to return as a string because BigInt cannot be directly converted to JSON
        return longObj.unsigned || value >= 0n ? value.toString() : value.toString();
      }
    } catch {
      // If BigInt is not available or does not work, use normal JavaScript numbers
    }
    
    // Fallback: Combine 32-bit values with bitwise operations
    const result = longObj.high * 4294967296 + (longObj.low >>> 0);
    return longObj.unsigned || result >= 0 ? result : result - 4294967296 * 2;
  }
  
  return longObj;
}

/**
 * Converts all Long values in objects to normal JavaScript values
 * @param obj Any object that may contain Long values
 * @returns Object with Long values converted
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
 * Decodes a transaction in Base64 format
 * @param txBase64 Transaction data in Base64 format
 * @returns Decoded transaction and message content
 */
export function decodeTx(txBase64: string): DecodedTx {
  // Convert from Base64 to binary
  const txBytes = base64ToBytes(txBase64);
  
  try {
    // Decode TX
    const tx = Tx.decode(txBytes);
    
    // Decode messages
    const decodedMessages = tx.body?.messages.map(msg => {
      return decodeAnyMessage(msg);
    }) || [];
    
    // Convert buffers to hex and Long values to normal values
    const processedTx = convertLongValues(convertBuffersToHex(tx)) as any;
    const processedMessages = convertLongValues(decodedMessages);
    
    return {
      tx: processedTx,
      messages: processedMessages,
      rawBytes: txBytes
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Transaction decode error:', errorMessage);
    
    return {
      tx: null,
      messages: [],
      rawBytes: txBytes,
      error: `Failed to decode transaction: ${errorMessage}`
    };
  }
}

/**
 * Processes events in the transaction result
 * @param events Events in the transaction result
 * @returns Processed events
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