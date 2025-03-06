/**
 * Block ve Transaction servisleri için interface tanımlamaları
 */

import { BaseBlock, BaseTx, WebsocketBlockEvent, WebsocketTxEvent } from './common';
import { Network } from '../../../types/finality';

export interface IBlockProcessorService {
  processBlock(blockData: any): Promise<BaseBlock>;
  processBlockFromWebsocket(blockEvent: WebsocketBlockEvent): Promise<BaseBlock>;
  getBlockByHeight(height: string | number): Promise<BaseBlock | null>;
}

export interface ITransactionProcessorService {
  processTx(txData: any): Promise<BaseTx>;
  processTxFromWebsocket(txEvent: WebsocketTxEvent): Promise<BaseTx>;
  getTxByHash(txHash: string): Promise<BaseTx | null>;
  getTxDetailByHash(txHash: string): Promise<any>;
}

export interface IHistoricalSyncService {
  startSync(network: Network, fromHeight?: number, blockCount?: number): Promise<void>;
  syncFromHeight(fromHeight: number, toHeight?: number, network?: Network): Promise<void>;
  syncLatestBlocks(blockCount?: number, network?: Network): Promise<void>;
}

export interface IHandlerService {
  handleNewBlock(blockEvent: WebsocketBlockEvent): Promise<void>;
  handleNewTx(txEvent: WebsocketTxEvent): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface IFallbackService {
  checkForMissingBlocks(lastProcessedHeight: number, currentHeight: number): Promise<void>;
  fetchBlockAndTxs(height: number): Promise<{block: BaseBlock, transactions: BaseTx[]}>;
}

export interface IFetcherService {
  fetchTxDetails(txHash: string): Promise<any>;
}

// Database interfaceleri
export interface IBlockStorage {
  saveBlock(block: BaseBlock, network: Network): Promise<void>;
  getBlockByHeight(height: string | number, network: Network): Promise<BaseBlock | null>;
  getBlockByHash(blockHash: string, network: Network): Promise<BaseBlock | null>;
  getLatestBlock(network: Network): Promise<BaseBlock | null>;
  getBlockCount(network: Network): Promise<number>;
}

export interface ITxStorage {
  saveTx(tx: BaseTx, network: Network): Promise<void>;
  getTxByHash(txHash: string, network: Network): Promise<BaseTx | null>;
  getTxsByHeight(height: string | number, network: Network): Promise<BaseTx[]>;
  getTxCount(network: Network): Promise<number>;
} 