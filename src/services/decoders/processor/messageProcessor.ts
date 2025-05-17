/**
 * Core message processing functionality
 */

import { Any } from '@generated/proto/google/protobuf/any';
import { MessageDecoder, SpecialCaseHandler, DecodedMessage } from '../types';
import { convertBuffersToHex, tryParseRawMessage } from '../utils/bufferUtils';
import { logger } from '../../../utils/logger';
import { ProtoModuleDiscovery } from '../discovery/protoModuleDiscovery';

/**
 * Handles decoding and processing of messages
 */
export class MessageProcessor {
  private decoderRegistry: Map<string, MessageDecoder>;
  private specialHandlers: Map<string, SpecialCaseHandler>;
  
  constructor(
    decoderRegistry: Map<string, MessageDecoder>,
    specialHandlers: Map<string, SpecialCaseHandler>
  ) {
    this.decoderRegistry = decoderRegistry;
    this.specialHandlers = specialHandlers;
  }
  
  /**
   * Decode a message using registered decoders
   */
  public decodeMessage(msg: Any): DecodedMessage {
    try {
      const decoder = this.decoderRegistry.get(msg.typeUrl);
      
      if (decoder) {
        return this.processWithDecoder(msg, decoder);
      }
      
      // If no registered decoder, try dynamic approach
      return this.dynamicDecode(msg);
    } catch (error) {
      // In case of error, return at least the type and raw data
      logger.warn(`Error decoding message ${msg.typeUrl}:`, error);
      return {
        typeUrl: msg.typeUrl,
        content: {
          rawValue: convertBuffersToHex(msg.value)
        }
      };
    }
  }
  
  /**
   * Process message with a registered decoder
   */
  private processWithDecoder(msg: Any, decoder: MessageDecoder): DecodedMessage {
    let content = decoder(msg.value);
    
    // Apply special handlers if any for this message type
    const specialHandler = this.specialHandlers.get(msg.typeUrl);
    if (specialHandler) {
      content = specialHandler(content);
    } else {
      content = convertBuffersToHex(content);
    }
    
    return {
      typeUrl: msg.typeUrl,
      content
    };
  }
  
  /**
   * Try to dynamically decode a message
   */
  private dynamicDecode(msg: Any): DecodedMessage {
    // Extract namespace and type from URL
    const typeName = msg.typeUrl.substring(1);
    const parts = typeName.split('.');
    
    // Various ways to find the module
    const attemptPaths = ProtoModuleDiscovery.buildModulePaths(parts);
    
    // Try all possible paths
    for (const attempt of attemptPaths) {
      try {
        const protoModule = require(attempt.path);
        
        if (protoModule && protoModule[attempt.msgType]) {
          return this.processWithDynamicDecoder(msg, protoModule, attempt.msgType);
        }
      } catch (e) {
        // Continue to the next attempt path
      }
    }
    
    // Last resort: try JSON parsing
    return {
      typeUrl: msg.typeUrl,
      content: tryParseRawMessage(msg.value)
    };
  }
  
  /**
   * Process with a dynamically discovered decoder
   */
  private processWithDynamicDecoder(msg: Any, protoModule: any, msgType: string): DecodedMessage {
    let content = protoModule[msgType].decode(msg.value);
    
    // Check if there is a special handler for this message type
    const specialHandler = this.specialHandlers.get(msg.typeUrl);
    if (specialHandler) {
      content = specialHandler(content);
    } else {
      content = convertBuffersToHex(content);
    }
    
    // Register this decoder for future use
    this.decoderRegistry.set(msg.typeUrl, (value: Uint8Array) => {
      return protoModule[msgType].decode(value);
    });
    
    return {
      typeUrl: msg.typeUrl,
      content
    };
  }
} 