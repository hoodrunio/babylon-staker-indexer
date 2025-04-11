/**
 * Main message registry that coordinates all decoder operations
 */

import { Any } from '../../../generated/proto/google/protobuf/any';
import { logger } from '../../../utils/logger';
import { DecodedMessage, MessageDecoder, SpecialCaseHandler } from '../types';
import { ProtoModuleDiscovery } from '../discovery/protoModuleDiscovery';
import { MessageProcessor } from '../processor/messageProcessor';
import { registerSpecialCaseHandlers } from '../handlers';

/**
 * Main registry for message decoders and handlers
 * Provides a centralized registry for all message types
 */
export class MessageRegistry {
  private messageDecoders = new Map<string, MessageDecoder>();
  private specialCaseHandlers = new Map<string, SpecialCaseHandler>();
  private protoDiscovery: ProtoModuleDiscovery;
  private messageProcessor: MessageProcessor;
  
  constructor() {
    // Initialize sub-components
    this.protoDiscovery = new ProtoModuleDiscovery(this.messageDecoders);
    this.messageProcessor = new MessageProcessor(
      this.messageDecoders,
      this.specialCaseHandlers
    );
    
    this.initializeRegistry();
  }
  
  /**
   * Initialize the registry
   */
  private initializeRegistry(): void {
    logger.info('[Message Decoder] Initializing message registry...');
    
    // Discover and register proto modules
    this.protoDiscovery.discoverAllModules();
    
    // Register special case handlers
    this.registerSpecialCases();
    
    logger.info(`[Message Decoder] Initialization complete.`);
  }
  
  /**
   * Register special case handlers
   */
  private registerSpecialCases(): void {
    // Use the centralized handler registration
    const handlers = registerSpecialCaseHandlers();
    
    // Copy all handlers to our registry
    handlers.forEach((handler, typeUrl) => {
      this.specialCaseHandlers.set(typeUrl, handler);
    });
  }
  
  /**
   * Decode a message of type Any
   */
  public decodeMessage(msg: Any): DecodedMessage {
    return this.messageProcessor.decodeMessage(msg);
  }
} 