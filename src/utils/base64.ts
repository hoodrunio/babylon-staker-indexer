/**
 * Base64 işleme için yardımcı fonksiyonlar
 */

/**
 * Base64 formatındaki veriyi Uint8Array'e dönüştürür
 * @param base64 Base64 formatındaki veri
 * @returns Uint8Array formatında veri
 */
export function base64ToBytes(base64: string): Uint8Array {
  return Buffer.from(base64, 'base64');
}

/**
 * Uint8Array'i Base64 formatına dönüştürür
 * @param bytes Uint8Array formatında veri
 * @returns Base64 formatında veri
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Base64 formatındaki veriyi hex formatına dönüştürür
 * @param base64 Base64 formatındaki veri
 * @returns Hex formatında veri
 */
export function base64ToHex(base64: string): string {
  const bytes = base64ToBytes(base64);
  return Buffer.from(bytes).toString('hex');
}

/**
 * Base64 formatındaki veriyi UTF-8 text'e dönüştürür
 * @param base64 Base64 formatındaki veri
 * @returns UTF-8 formatında veri
 */
export function base64ToText(base64: string): string {
  const bytes = base64ToBytes(base64);
  return new TextDecoder().decode(bytes);
}

/**
 * Base64 formatındaki JSON veriyi parse eder
 * @param base64 Base64 formatındaki JSON veri
 * @returns Parse edilmiş JSON objesi
 */
export function base64ToJson(base64: string): any {
  try {
    const text = base64ToText(base64);
    return JSON.parse(text);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Base64 JSON parse edilemedi: ${errorMessage}`);
  }
} 