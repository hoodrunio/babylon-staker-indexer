import { Any } from '../../generated/proto/google/protobuf/any';
import { MESSAGE_TYPES } from './messageTypes';
import { logger } from '../../utils/logger';
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
function tryParseRawMessage(value: Uint8Array) {
  try {
    // First decode as string
    const text = new TextDecoder().decode(value);
    // Try JSON parsing
    return JSON.parse(text);
  } catch {
    // If it cannot be parsed as JSON, return as hex
    return {
      rawValue: bufferToHex(value)
    };
  }
}

/**
 * Registry for message type decoders
 * Provides an efficient and maintainable way to handle multiple message types
 */
class MessageRegistry {
  private messageDecoders = new Map<string, (value: Uint8Array) => any>();
  private specialCaseHandlers = new Map<string, (decoded: any) => any>();
  
  constructor() {
    this.discoverProtoModules();
    this.registerSpecialCases();
  }
  
  /**
   * Discovers and registers message decoders from proto modules
   */
  private discoverProtoModules() {
    logger.info('[Message Decoder] Initializing message registry...');
    
    // Babylon messages
    this.discoverNamespace('babylon', [
      'finality/v1', 
      'btcstaking/v1', 
      'epoching/v1', 
      'checkpointing/v1',
      'btclightclient/v1'
    ], '../../generated/proto');
    
    // CosmWasm messages
    this.discoverNamespace('cosmwasm', [
      'wasm/v1'
    ], '../../generated/proto');
    
    // Cosmos SDK messages
    this.discoverNamespace('cosmos', [
      'bank/v1beta1',
      'staking/v1beta1', 
      'distribution/v1beta1',
      'gov/v1beta1',
      'authz/v1beta1',
      'feegrant/v1beta1',
      'evidence/v1beta1',
      'slashing/v1beta1',
      'vesting/v1beta1'
    ], 'cosmjs-types');
    
    logger.info(`[Message Decoder] Registered ${this.messageDecoders.size} message types.`);
  }
  
  /**
   * Discovers and registers message decoders from a specific namespace
   */
  private discoverNamespace(namespace: string, modules: string[], basePath: string) {
    for (const module of modules) {
      try {
        const importPath = `${basePath}/${namespace}/${module}/tx`;
        let protoModule;
        
        try {
          const relativePath = basePath.startsWith('..') 
            ? importPath 
            : `${basePath}/${namespace}/${module}/tx`;
          
          protoModule = require(relativePath);
        } catch (e) {
          logger.warn(`Could not load module: ${importPath}`, e);
          continue;
        }
        
        // Register message types from the module
        for (const key in protoModule) {
          if (key.startsWith('Msg')) {
            const typeUrl = `/${namespace}.${module.replace('/', '.')}.${key}`;
            
            this.messageDecoders.set(typeUrl, (value: Uint8Array) => {
              return protoModule[key].decode(value);
            });
          }
        }
      } catch (e) {
        logger.warn(`Error processing namespace ${namespace} module ${module}`, e);
      }
    }
  }
  
  /**
   * Registers special case handlers for message types needing custom processing
   */
  private registerSpecialCases() {
    // Handle CosmWasm MsgExecuteContract JSON parsing
    this.specialCaseHandlers.set(MESSAGE_TYPES.EXECUTE_CONTRACT, (decoded) => {
      if (decoded.msg) {
        try {
          const jsonMsg = JSON.parse(new TextDecoder().decode(decoded.msg));
          return { ...decoded, msg: jsonMsg };
        } catch {
          // If JSON parsing fails, return the original content
        }
      }
      return decoded;
    });

    this.specialCaseHandlers.set(MESSAGE_TYPES.INJECTED_CHECKPOINT, (decoded) => {
      if (decoded.msg) {
        try {
          const jsonMsg = JSON.parse(new TextDecoder().decode(decoded.msg));
          return { ...decoded, msg: jsonMsg };
        } catch {
          // If JSON parsing fails, return the original content
        }
      }
      return decoded;
    });
    
    // Handle CosmWasm MsgInstantiateContract JSON parsing
    this.specialCaseHandlers.set(MESSAGE_TYPES.INSTANTIATE_CONTRACT, (decoded) => {
      if (decoded.msg) {
        try {
          const jsonMsg = JSON.parse(new TextDecoder().decode(decoded.msg));
          return { ...decoded, msg: jsonMsg };
        } catch {
          // If JSON parsing fails, return the original content
        }
      }
      return decoded;
    });
    
    // More special cases can be added here if needed
  }
  
  /**
   * Decodes a message based on its type URL
   */
  public decodeMessage(msg: Any): {
    typeUrl: string;
    content: any;
    rawValue?: Uint8Array;
  } {
    try {
      const decoder = this.messageDecoders.get(msg.typeUrl);
      
      if (decoder) {
        let content = decoder(msg.value);
        
        // Apply special handlers if they exist for this message type
        const specialHandler = this.specialCaseHandlers.get(msg.typeUrl);
        if (specialHandler) {
          content = specialHandler(content);
        }
        
        return {
          typeUrl: msg.typeUrl,
          content: convertBuffersToHex(content)
        };
      }
      
      // If no registered decoder, try dynamic approach
      return this.dynamicDecode(msg);
    } catch (error) {
      // At minimum, return the type and raw data in case of error
      return {
        typeUrl: msg.typeUrl,
        content: null,
        rawValue: msg.value,
        error: `Decode error: ${error instanceof Error ? error.message : String(error)}`
      } as any;
    }
  }
  
  /**
   * Attempts to dynamically decode a message by inferring its module and type
   */
  private dynamicDecode(msg: Any): {
    typeUrl: string;
    content: any;
    rawValue?: Uint8Array;
  } {
    // Extract namespace and type from the URL
    const typeName = msg.typeUrl.substring(1);
    const parts = typeName.split('.');
    const namespace = parts.slice(0, -1).join('/');
    const msgType = parts[parts.length - 1];
    
    try {
      let protoModule;
      
      // Try to infer module location and load it
      if (typeName.startsWith('babylon.') || typeName.startsWith('cosmwasm.')) {
        protoModule = require(`../../generated/proto/${namespace}/tx`);
      } else if (typeName.startsWith('cosmos.')) {
        protoModule = require(`cosmjs-types/${namespace}/tx`);
      }
      
      if (protoModule && protoModule[msgType]) {
        // Found the message type, decode it
        return {
          typeUrl: msg.typeUrl,
          content: convertBuffersToHex(protoModule[msgType].decode(msg.value))
        };
      }
    } catch (e) {
      // Log failure to import but continue with fallback
      logger.warn(`Dynamic decoding failed for: ${msg.typeUrl}`, e);
    }
    
    // Last resort: Try JSON parsing
    return {
      typeUrl: msg.typeUrl,
      content: tryParseRawMessage(msg.value)
    };
  }
}

// Create a singleton instance of the message registry
const messageRegistry = new MessageRegistry();

/**
 * Decodes a message of type Any based on its content.
 * @param anyMsg The message of type Any.
 * @returns The decoded message and its type.
 */
export function decodeAnyMessage(anyMsg: Any): {
  typeUrl: string;
  content: any;
  rawValue?: Uint8Array;
} {
  return messageRegistry.decodeMessage(anyMsg);
}