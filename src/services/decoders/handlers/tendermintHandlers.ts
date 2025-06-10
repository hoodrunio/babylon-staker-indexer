/**
 * Handlers for Tendermint light client messages
 */

import { logger } from '../../../utils/logger';
import { SpecialCaseHandler } from '../types';
import { convertBuffersToHex } from '../utils/bufferUtils';
import { Header } from '../../../generated/proto/ibc/lightclients/tendermint/v1/tendermint';
/**
 * Utilities for processing Tendermint data
 */
export class TendermintUtils {
  /**
   * Create filtered Tendermint header with large fields removed
   */
  static createFilteredHeader(headerDecoded: any) {
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
}

/**
 * Creates a handler for Tendermint client updates
 */
export function createTendermintClientHandler(): SpecialCaseHandler {
  return (decoded: any) => {
    try {
      if (decoded.clientMessage && decoded.clientMessage.typeUrl === '/ibc.lightclients.tendermint.v1.Header') {
        if (decoded.clientMessage.value) {
          const headerDecoded = Header.decode(decoded.clientMessage.value);
          
          const filteredHeader = TendermintUtils.createFilteredHeader(headerDecoded);
          
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