/**
 * Export all message handlers
 */

export * from './jsonHandlers';
export * from './ibcHandlers';
export * from './tendermintHandlers';

import { SpecialCaseHandler } from '../types';
import { MESSAGE_TYPES } from '../messageTypes';
import { createJsonParsingHandler } from './jsonHandlers';
import { getIBCPacketHandlers } from './ibcHandlers';
import { createTendermintClientHandler } from './tendermintHandlers';

/**
 * Register all special case handlers
 */
export function registerSpecialCaseHandlers(): Map<string, SpecialCaseHandler> {
  const handlers = new Map<string, SpecialCaseHandler>();
  
  // Register CosmWasm contract processing handlers
  const jsonHandler = createJsonParsingHandler();
  handlers.set(MESSAGE_TYPES.EXECUTE_CONTRACT, jsonHandler);
  handlers.set(MESSAGE_TYPES.INJECTED_CHECKPOINT, jsonHandler);
  handlers.set(MESSAGE_TYPES.INSTANTIATE_CONTRACT, jsonHandler);
  
  // Register Tendermint light client handler
  handlers.set('/ibc.core.client.v1.MsgUpdateClient', createTendermintClientHandler());
  
  // Register IBC packet handlers
  const ibcHandlers = getIBCPacketHandlers();
  for (const [typeUrl, handler] of Object.entries(ibcHandlers)) {
    handlers.set(typeUrl, handler);
  }
  
  return handlers;
} 