/**
 * Common types for Block and Transaction services
 */

import { Types } from 'mongoose';

export interface BaseBlock {
  height: string;
  blockHash: string;
  proposer: Types.ObjectId;
  numTxs: number;
  time: string;
  signatures: SignatureInfo[];
  appHash: string;
  totalGasWanted: string;
  totalGasUsed: string;
}

export interface SimpleBlock {
  height: string;
  blockHash: string;
  proposer: any; // Will be populated with validator info
  numTxs: number;
  time: string;
}

export interface PaginatedBlocksResponse {
  blocks: SimpleBlock[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface SignatureInfo {
  validator: Types.ObjectId;
  timestamp: string;
}

export interface BaseTx {
  txHash: string;
  height: string;
  status: TxStatus;
  fee: {
    amount: Array<{
      denom: string;
      amount: string;
    }>;
    gasLimit: string;
  };
  messageCount: number;
  type: string;
  time: string;
  meta?: TxMessage[];
  totalCount?: number;
  reason?: string;
}

export interface SimpleTx {
  txHash: string;
  height: string;
  status: TxStatus;
  type: string;
  firstMessageType?: string;
  time: string;
  messageCount: number;
}

export interface PaginatedTxsResponse {
  transactions: SimpleTx[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface TxMessage {
  typeUrl: string;
  content: any;
}

export enum TxStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  PENDING = 'PENDING'
}

// Types for block and tx events received via websocket
export interface WebsocketEventData {
  type: string;
  value: any;
}

export interface WebsocketBlockEvent {
  query: string;
  data: {
    type: string;
    value: {
      block: any;
      block_id: any;
      result_finalize_block: any;
    }
  };
  events: any;
}

export interface WebsocketTxEvent {
  query: string;
  data: {
    type: string;
    value: {
      TxResult: {
        height: string;
        tx: string; // Base64 encoded tx
        result: {
          code: number;
          log: string;
          gas_used: string;
          events: any[];
          codespace: string;
        }
      }
    }
  };
  events: {
    'tx.hash': string[];
    'tx.height': string[];
    'tm.event': string[];
  };
}

// Error types
export class BlockProcessorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockProcessorError';
  }
}

export class TxProcessorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TxProcessorError';
  }
} 