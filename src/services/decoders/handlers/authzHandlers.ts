/**
 * Handlers for Authz (Authorization) module messages
 */

import { logger } from '../../../utils/logger';
import { Any } from '@generated/proto/google/protobuf/any';
import { SpecialCaseHandler } from '../types';
import { convertBuffersToHex } from '../utils/bufferUtils';

/**
 * Creates a handler for MsgExec messages from the authz module
 * This handles messages where one account is authorized to perform actions on behalf of another
 */
export function createAuthzMsgExecHandler(messageRegistry: any): SpecialCaseHandler {
  return (decoded: any) => {
    try {
      // Handle the MsgExec structure which contains embedded messages
      if (decoded.msgs && Array.isArray(decoded.msgs)) {
        // Process each inner message
        decoded.decodedMsgs = decoded.msgs.map((msg: Any) => {
          try {
            // Use the main registry to decode each inner message
            return messageRegistry.decodeMessage(msg);
          } catch (error) {
            logger.error(`[Message Decoder] Failed to decode inner authz message: ${error}`);
            return {
              typeUrl: msg.typeUrl,
              value: msg.value, // Keep the original value if decoding fails
              error: 'Failed to decode inner message'
            };
          }
        });
        
        // We can remove the original binary messages since we've decoded them
        delete decoded.msgs;
      }
      
      return convertBuffersToHex(decoded);
    } catch (error) {
      logger.error(`[Message Decoder] Failed to process authz MsgExec: ${error}`);
      return decoded;
    }
  };
}
