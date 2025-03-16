/**
 * Data compression utility functions
 */
import zlib from 'zlib';
import { logger } from './logger';

/**
 * Compresses data and returns it in base64 format
 * @param data Data to be compressed
 * @returns Compressed and base64 encoded data
 */
export function compressData(data: any): string {
  try {
    // Convert data to JSON string
    const jsonString = JSON.stringify(data);
    
    // Compress data (gzip)
    const compressed = zlib.gzipSync(Buffer.from(jsonString, 'utf-8'));
    
    // Convert to base64 format
    return compressed.toString('base64');
  } catch (error) {
    logger.error(`Data compression error: ${error instanceof Error ? error.message : String(error)}`);
    // In case of error, return the original data as a JSON string
    return JSON.stringify(data);
  }
}

/**
 * Decompresses compressed data and converts it to a JavaScript object
 * @param compressedData Compressed and base64 encoded data
 * @returns Decompressed JavaScript object
 */
export function decompressData(compressedData: string): any {
  try {
    // Convert from base64 to buffer
    const buffer = Buffer.from(compressedData, 'base64');
    
    // Decompress
    const decompressed = zlib.gunzipSync(buffer);
    
    // Convert to JavaScript object with JSON parse
    return JSON.parse(decompressed.toString('utf-8'));
  } catch (error) {
    logger.error(`Data decompression error: ${error instanceof Error ? error.message : String(error)}`);
    
    // Maybe it's an uncompressed JSON string, try parsing directly
    try {
      return JSON.parse(compressedData);
    } catch {
      // If it cannot be parsed in any way, return an empty array
      return [];
    }
  }
}