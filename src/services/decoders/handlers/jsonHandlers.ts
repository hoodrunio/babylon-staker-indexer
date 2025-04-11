/**
 * Handlers for JSON processing in messages
 */

import { SpecialCaseHandler } from '../types';

/**
 * Creates a handler that parses JSON data in message fields
 */
export function createJsonParsingHandler(): SpecialCaseHandler {
  return (decoded) => {
    if (decoded.msg) {
      try {
        const jsonMsg = JSON.parse(new TextDecoder().decode(decoded.msg));
        return { ...decoded, msg: jsonMsg };
      } catch {
        // If JSON parsing fails, return the original content
      }
    }
    return decoded;
  };
} 