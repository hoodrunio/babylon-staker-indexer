/**
 * Helper functions for Base64 processing
 */

/**
 * Converts Base64 formatted data to Uint8Array
 * @param base64 Base64 formatted data
 * @returns Data in Uint8Array format
 */
export function base64ToBytes(base64: string): Uint8Array {
  return Buffer.from(base64, 'base64');
}

/**
 * Converts Uint8Array to Base64 format
 * @param bytes Uint8Array format data
 * @returns Data in Base64 format
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Converts Base64 formatted data to hex format
 * @param base64 Base64 formatted data
 * @returns Data in hex format
 */
export function base64ToHex(base64: string): string {
  const bytes = base64ToBytes(base64);
  return Buffer.from(bytes).toString('hex');
}

/**
 * Converts Base64 formatted data to UTF-8 text
 * @param base64 Base64 formatted data
 * @returns Data in UTF-8 format
 */
export function base64ToText(base64: string): string {
  const bytes = base64ToBytes(base64);
  return new TextDecoder().decode(bytes);
}

/**
 * Parses Base64 formatted JSON data
 * @param base64 Base64 formatted JSON data
 * @returns Parsed JSON object
 */
export function base64ToJson(base64: string): any {
  try {
    const text = base64ToText(base64);
    return JSON.parse(text);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Base64 JSON could not be parsed: ${errorMessage}`);
  }
} 