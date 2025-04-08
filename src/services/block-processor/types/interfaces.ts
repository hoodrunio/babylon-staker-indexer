/**
 * Interface definitions for Block and Transaction services
 */

import { BaseBlock, BaseTx, WebsocketBlockEvent, WebsocketTxEvent } from './common';
import { Network } from '../../../types/finality';

export interface IBlockProcessorService {
  processBlock(blockData: any): Promise<BaseBlock>;
  processBlockFromWebsocket(blockEvent: WebsocketBlockEvent): Promise<BaseBlock>;
  getBlockByHeight(height: string | number): Promise<BaseBlock | null>;
  getBlockByHash(blockHash: string): Promise<BaseBlock | null>;
  setNetwork(network: Network): void;
  getNetwork(): Network;
  isNetworkConfigured(): boolean;
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
  fetchTxDetails(txHash: string, network: Network): Promise<any>;
  fetchTxsByHeight(height: number | string, network: Network): Promise<any[]>;
  fetchBlockByHeight(height: number | string, network: Network): Promise<any>;
  fetchBlockByHash(blockHash: string, network: Network): Promise<any>;
  fetchLatestBlock(network: Network): Promise<any>;
  getSupportedNetworks(): Network[];
}

// Database interfaces
export interface IBlockStorage {
  saveBlock(block: BaseBlock, network: Network): Promise<void>;
  getBlockByHeight(height: string | number, network: Network, useRawFormat?: boolean): Promise<BaseBlock | any | null>;
  getBlockByHash(blockHash: string, network: Network, useRawFormat?: boolean): Promise<BaseBlock | any | null>;
  getLatestBlock(network: Network, useRawFormat?: boolean): Promise<BaseBlock | any | null>;
  getBlockCount(network: Network): Promise<number>;
}

export interface ITxStorage {
  saveTx(tx: BaseTx, network: Network): Promise<void>;
  getTxByHash(txHash: string, network: Network, useRawFormat?: boolean): Promise<BaseTx | any | null>;
  getTxsByHeight(height: string | number, network: Network, useRawFormat?: boolean): Promise<BaseTx[] | any[]>;
  getTxCount(network: Network): Promise<number>;
}