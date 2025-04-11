import { Any } from '../../generated/proto/google/protobuf/any';
import { MESSAGE_TYPES } from './messageTypes';
import { logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

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
    const text = new TextDecoder().decode(value);
    return JSON.parse(text);
  } catch {
    return {
      rawValue: bufferToHex(value)
    };
  }
}

type MessageDecoder = (value: Uint8Array) => any;
type SpecialCaseHandler = (decoded: any) => any;
type DecodedMessage = {
  typeUrl: string;
  content: any;
};

/**
 * Helper function for JSON parsing handler
 */
function createJsonParsingHandler(): SpecialCaseHandler {
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

/**
 * Helper function to process IBC packet data
 */
function processIBCPacketData(decoded: any): any {
  if (decoded.packet && decoded.packet.data) {
    try {
      const jsonData = Buffer.from(decoded.packet.data).toString('utf8');
      
      try {
        decoded.packet.parsedData = JSON.parse(jsonData);
      } catch (e) {
        decoded.packet.dataString = jsonData;
      }
      
      delete decoded.packet.data; // Remove raw binary data
    } catch (error) {
      logger.error(`[Message Decoder] Failed to process IBC packet data: ${error}`);
    }
  }
  
  return decoded;
}

/**
 * Helper function to process IBC acknowledgement data
 */
function processIBCAcknowledgement(decoded: any): any {
  if (decoded.acknowledgement) {
    try {
      const ackString = Buffer.from(decoded.acknowledgement).toString('utf8');
      try {
        decoded.parsedAcknowledgement = JSON.parse(ackString);
      } catch (e) {
        decoded.acknowledgementString = ackString;
      }
      delete decoded.acknowledgement;
    } catch (e) {
      // Keep original if conversion fails
    }
  }
  
  return decoded;
}

/**
 * Registry for message type decoders
 * Provides an efficient and maintainable way to handle multiple message types
 */
class MessageRegistry {
  private messageDecoders = new Map<string, MessageDecoder>();
  private specialCaseHandlers = new Map<string, SpecialCaseHandler>();
  
  constructor() {
    this.initializeRegistry();
    this.registerSpecialCases();
  }
  
  /**
   * Initialize the message registry by registering all message types
   */
  private initializeRegistry() {
    logger.info('[Message Decoder] Initializing message registry...');
    
    this.registerStandardNamespaces();
    this.discoverGeneratedProtos();
    
    logger.info(`[Message Decoder] Registered ${this.messageDecoders.size} message types.`);
  }
  
  /**
   * Register standard namespaces that we know about
   */
  private registerStandardNamespaces() {
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
    
    // IBC messages
    this.discoverNamespace('ibc', [
      'core/client/v1',
      'core/channel/v1',
      'core/connection/v1',
      'applications/transfer/v1'
    ], '../../generated/proto');
  }
  
  /**
   * Automatically discover all proto modules in the generated directory
   */
  private discoverGeneratedProtos() {
    try {
      const generatedBaseDir = path.resolve(__dirname, '../../generated/proto');
      this.autoDiscoverProtoModules(generatedBaseDir);
    } catch (error) {
      logger.warn('Failed to auto-discover proto modules:', error);
    }
  }
  
  /**
   * Recursively scan directory for tx.js files and register their message types
   */
  private autoDiscoverProtoModules(baseDir: string, currentPath: string = '') {
    try {
      const fullPath = path.join(baseDir, currentPath);
      const items = fs.readdirSync(fullPath);
      
      for (const item of items) {
        const itemPath = path.join(fullPath, item);
        const relativePath = path.join(currentPath, item);
        const stats = fs.statSync(itemPath);
        
        if (stats.isDirectory()) {
          this.autoDiscoverProtoModules(baseDir, relativePath);
        } else if (item === 'tx.js' || item === 'tx.cjs') {
          this.registerTxModule(baseDir, currentPath, relativePath);
        }
      }
    } catch (error) {
      logger.warn(`Error scanning directory ${currentPath}:`, error);
    }
  }
  
  /**
   * Register a tx module found during discovery
   */
  private registerTxModule(baseDir: string, currentPath: string, relativePath: string) {
    try {
      const importPath = '../../generated/proto/' + currentPath.replace(/\\/g, '/').replace(/\.js$/, '');
      const protoModule = require(importPath);
      
      // Get namespace from path (convert path segments to dot notation for typeUrl)
      const pathSegments = currentPath.split(path.sep).filter(s => s !== 'proto' && s !== 'tx.js' && s !== 'tx.cjs');
      const namespace = pathSegments.join('.');
      
      this.registerProtoModuleMessages(protoModule, namespace);
    } catch (error) {
      logger.warn(`Failed to load proto module from ${relativePath}:`, error);
    }
  }
  
  /**
   * Register all message types from a proto module
   */
  private registerProtoModuleMessages(protoModule: any, namespace: string) {
    for (const key in protoModule) {
      if (key.startsWith('Msg')) {
        const typeUrl = `/${namespace}.${key}`;
        
        this.messageDecoders.set(typeUrl, (value: Uint8Array) => {
          return protoModule[key].decode(value);
        });
        
        logger.debug(`Registered message type: ${typeUrl}`);
      }
    }
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
        
        this.registerModuleMessages(protoModule, namespace, module);
      } catch (e) {
        logger.warn(`Error processing namespace ${namespace} module ${module}`, e);
      }
    }
  }
  
  /**
   * Register message types from a module
   */
  private registerModuleMessages(protoModule: any, namespace: string, module: string) {
    for (const key in protoModule) {
      if (key.startsWith('Msg')) {
        const typeUrl = `/${namespace}.${module.replace('/', '.')}.${key}`;
        
        this.messageDecoders.set(typeUrl, (value: Uint8Array) => {
          return protoModule[key].decode(value);
        });
      }
    }
  }
  
  /**
   * Registers special case handlers for message types needing custom processing
   */
  private registerSpecialCases() {
    // CosmWasm contract processing
    const jsonHandler = createJsonParsingHandler();
    this.specialCaseHandlers.set(MESSAGE_TYPES.EXECUTE_CONTRACT, jsonHandler);
    this.specialCaseHandlers.set(MESSAGE_TYPES.INJECTED_CHECKPOINT, jsonHandler);
    this.specialCaseHandlers.set(MESSAGE_TYPES.INSTANTIATE_CONTRACT, jsonHandler);
    
    // IBC Client Messages - Special processing for Tendermint light client
    this.specialCaseHandlers.set('/ibc.core.client.v1.MsgUpdateClient', this.createTendermintClientHandler());
    
    // Register IBC packet handlers
    this.registerIBCPacketHandlers();
  }
  
  /**
   * Create handler for Tendermint client updates
   */
  private createTendermintClientHandler(): SpecialCaseHandler {
    return (decoded: any) => {
      try {
        if (decoded.clientMessage && decoded.clientMessage.typeUrl === '/ibc.lightclients.tendermint.v1.Header') {
          const { Header } = require('../../generated/proto/ibc/lightclients/tendermint/v1/tendermint');
          
          if (decoded.clientMessage.value) {
            const headerDecoded = Header.decode(decoded.clientMessage.value);
            
            const filteredHeader = this.createFilteredTendermintHeader(headerDecoded);
            
            decoded.clientMessage = {
              typeUrl: decoded.clientMessage.typeUrl,
              decodedValue: filteredHeader
            };
          }
        }
        
        return convertBuffersToHex(decoded);
      } catch (error) {
        logger.error(`[Message Decoder] Failed to decode Tendermint client update: ${error}`);
        return decoded;
      }
    };
  }
  
  /**
   * Create filtered Tendermint header
   */
  private createFilteredTendermintHeader(headerDecoded: any) {
    return {
      ...headerDecoded,
      signedHeader: headerDecoded.signedHeader ? {
        header: headerDecoded.signedHeader.header,
        commit: {
          height: headerDecoded.signedHeader.commit?.height,
          round: headerDecoded.signedHeader.commit?.round,
          blockId: headerDecoded.signedHeader.commit?.blockId,
          signatures_filtered: true,
          signatures_count: headerDecoded.signedHeader.commit?.signatures?.length || 0
        }
      } : undefined,
      validatorSet_filtered: true,
      validatorSet_count: headerDecoded.validatorSet?.validators?.length || 0,
      trustedHeight: headerDecoded.trustedHeight,
      trustedValidators_filtered: true,
      trustedValidators_count: headerDecoded.trustedValidators?.validators?.length || 0
    };
  }
  
  /**
   * Register handlers for IBC packet data
   */
  private registerIBCPacketHandlers() {
    // Handler for MsgRecvPacket
    this.specialCaseHandlers.set('/ibc.core.channel.v1.MsgRecvPacket', (decoded: any) => {
      try {
        const processedData = processIBCPacketData(decoded);
        return convertBuffersToHex(processedData);
      } catch (error) {
        logger.error(`[Message Decoder] Failed to process IBC packet data: ${error}`);
        return decoded;
      }
    });
    
    // Handler for MsgAcknowledgement
    this.specialCaseHandlers.set('/ibc.core.channel.v1.MsgAcknowledgement', (decoded: any) => {
      try {
        let processedData = processIBCPacketData(decoded);
        processedData = processIBCAcknowledgement(processedData);
        
        return convertBuffersToHex(processedData);
      } catch (error) {
        logger.error(`[Message Decoder] Failed to process IBC ack data: ${error}`);
        return decoded;
      }
    });
  }
  
  /**
   * Decodes a message based on its type URL
   */
  public decodeMessage(msg: Any): DecodedMessage {
    try {
      const decoder = this.messageDecoders.get(msg.typeUrl);
      
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
          rawValue: bufferToHex(msg.value)
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
    const specialHandler = this.specialCaseHandlers.get(msg.typeUrl);
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
   * Attempts to dynamically decode a message by inferring its module and type
   */
  private dynamicDecode(msg: Any): DecodedMessage {
    // Extract namespace and type from URL
    const typeName = msg.typeUrl.substring(1);
    const parts = typeName.split('.');
    
    // Various ways to find the module
    const attemptPaths = this.buildModulePaths(parts);
    
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
   * Process message with a dynamically found decoder
   */
  private processWithDynamicDecoder(msg: Any, protoModule: any, msgType: string): DecodedMessage {
    let content = protoModule[msgType].decode(msg.value);
    
    // Check if there is a special handler for this message type
    const specialHandler = this.specialCaseHandlers.get(msg.typeUrl);
    if (specialHandler) {
      content = specialHandler(content);
    } else {
      content = convertBuffersToHex(content);
    }
    
    // Register this decoder for future use
    this.messageDecoders.set(msg.typeUrl, (value: Uint8Array) => {
      return protoModule[msgType].decode(value);
    });
    
    return {
      typeUrl: msg.typeUrl,
      content
    };
  }
  
  /**
   * Build potential module paths to try for dynamic decoding
   */
  private buildModulePaths(parts: string[]): Array<{path: string; msgType: string}> {
    const attemptPaths: Array<{path: string; msgType: string}> = [];
    
    if (parts.length >= 3) {
      // Standard format: namespace.module.version.MsgType 
      // e.g., ibc.core.client.v1.MsgUpdateClient
      const namespace = parts[0];
      const modulePath = parts.slice(1, -1).join('/');
      const msgType = parts[parts.length - 1];
      
      // Try different possible paths
      attemptPaths.push({
        path: `../../generated/proto/${namespace}/${modulePath}/tx`,
        msgType
      });
      
      // For Cosmos SDK modules
      if (namespace === 'cosmos') {
        attemptPaths.push({
          path: `cosmjs-types/${namespace}/${modulePath}/tx`,
          msgType
        });
      }
      
      // For other paths that may follow different conventions
      const altModulePath = parts.slice(0, -1).join('/');
      attemptPaths.push({
        path: `../../generated/proto/${altModulePath}/tx`,
        msgType
      });
    }
    
    return attemptPaths;
  }
}

// Create a single instance of the message registry
const messageRegistry = new MessageRegistry();

/**
 * Decodes a message of type Any based on its content.
 * @param anyMsg The message of type Any.
 * @returns The decoded message and its type.
 */
export function decodeAnyMessage(anyMsg: Any): DecodedMessage {
  return messageRegistry.decodeMessage(anyMsg);
}