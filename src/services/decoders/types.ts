/**
 * Type definitions for message decoders
 */

import { Any } from '../../generated/proto/google/protobuf/any';

/**
 * Function that decodes a raw binary message into a typed object
 */
export type MessageDecoder = (value: Uint8Array) => any;

/**
 * Function that applies special handling to already decoded messages
 */
export type SpecialCaseHandler = (decoded: any) => any;

/**
 * Represents a decoded message with its type URL and content
 */
export type DecodedMessage = {
  typeUrl: string;
  content: any;
}; 