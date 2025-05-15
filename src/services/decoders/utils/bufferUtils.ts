/**
 * Utilities for handling buffer objects and conversions
 */

/**
 * Helper function to convert buffer objects to hexadecimal strings
 */
export function bufferToHex(buffer: Uint8Array | Buffer | null | undefined): string {
  if (!buffer) return '';
  return Buffer.from(buffer).toString('hex');
}

/**
 * Converts all Buffer values within objects to hex strings
 */
export function convertBuffersToHex(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Buffer.isBuffer(obj) || (obj && obj.type === 'Buffer' && Array.isArray(obj.data))) {
    return bufferToHex(Buffer.isBuffer(obj) ? obj : Buffer.from(obj.data));
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => convertBuffersToHex(item));
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = convertBuffersToHex(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * Tries to parse raw message data as JSON
 */
export function tryParseRawMessage(value: Uint8Array) {
  try {
    const text = new TextDecoder().decode(value);
    return JSON.parse(text);
  } catch {
    return {
      rawValue: bufferToHex(value)
    };
  }
} 