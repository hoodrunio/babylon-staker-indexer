/**
 * Message decoder public API
 */

import { Any } from '@generated/proto/google/protobuf/any';
import { DecodedMessage } from './types';
import { MessageRegistry } from './registry/messageRegistry';

// Create a singleton instance of the registry
const messageRegistry = new MessageRegistry();

/**
 * Decodes a message of type Any based on its content.
 * @param anyMsg The message of type Any.
 * @returns The decoded message and its type.
 */
export function decodeAnyMessage(anyMsg: Any): DecodedMessage {
  return messageRegistry.decodeMessage(anyMsg);
}