/**
 * Handlers for IBC (Inter-Blockchain Communication) messages
 */

import { logger } from '../../../utils/logger';
import { SpecialCaseHandler } from '../types';
import { convertBuffersToHex } from '../utils/bufferUtils';

/**
 * Utilities for processing IBC packets
 */
export class IBCPacketUtils {
  /**
   * Process IBC packet data
   */
  static processPacketData(decoded: any): any {
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
   * Process IBC acknowledgement data
   */
  static processAcknowledgement(decoded: any): any {
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
}

/**
 * Creates a handler for IBC RecvPacket messages
 */
export function createIBCRecvPacketHandler(): SpecialCaseHandler {
  return (decoded: any) => {
    try {
      const processedData = IBCPacketUtils.processPacketData(decoded);
      return convertBuffersToHex(processedData);
    } catch (error) {
      logger.error(`[Message Decoder] Failed to process IBC packet data: ${error}`);
      return decoded;
    }
  };
}

/**
 * Creates a handler for IBC Acknowledgement messages
 */
export function createIBCAcknowledgementHandler(): SpecialCaseHandler {
  return (decoded: any) => {
    try {
      let processedData = IBCPacketUtils.processPacketData(decoded);
      processedData = IBCPacketUtils.processAcknowledgement(processedData);
      
      return convertBuffersToHex(processedData);
    } catch (error) {
      logger.error(`[Message Decoder] Failed to process IBC ack data: ${error}`);
      return decoded;
    }
  };
}

/**
 * Creates a handler for IBC transfer messages
 */
export function createIBCTransferHandler(): SpecialCaseHandler {
  return (decoded: any) => {
    try {
      // Handle potential binary data in memo field
      if (decoded.memo && typeof decoded.memo !== 'string') {
        try {
          const memoStr = Buffer.from(decoded.memo).toString('utf8');
          try {
            decoded.parsedMemo = JSON.parse(memoStr);
          } catch (e) {
            decoded.memoString = memoStr;
          }
          delete decoded.memo;
        } catch (e) {
          // Keep original if conversion fails
        }
      }
      
      return convertBuffersToHex(decoded);
    } catch (error) {
      logger.error(`[Message Decoder] Failed to process IBC transfer data: ${error}`);
      return decoded;
    }
  };
}

/**
 * Get all IBC packet handlers
 */
export function getIBCPacketHandlers(): Record<string, SpecialCaseHandler> {
  return {
    '/ibc.core.channel.v1.MsgRecvPacket': createIBCRecvPacketHandler(),
    '/ibc.core.channel.v1.MsgAcknowledgement': createIBCAcknowledgementHandler(),
    '/ibc.applications.transfer.v1.MsgTransfer': createIBCTransferHandler()
  };
} 