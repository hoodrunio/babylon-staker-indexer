/**
 * Block ve Transaction servisleri için ortak tipler
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
  meta: TxMessage[];
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

// Websocket üzerinden gelen block ve tx eventleri için tipler
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

// Hata tipleri
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