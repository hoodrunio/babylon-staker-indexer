/**
 * Transaction processing service
 */

import { BaseTx, TxMessage, TxProcessorError, TxStatus, WebsocketTxEvent } from '../types/common';
import { ITransactionProcessorService, ITxStorage } from '../types/interfaces';
import { decodeTx } from '../../../decoders/transaction';
import { Network } from '../../../types/finality';

export class TransactionProcessorService implements ITransactionProcessorService {
  private network: Network;

  constructor(
    private readonly txStorage: ITxStorage,
    private readonly fetchTxDetails: (txHash: string) => Promise<any>,
    network: Network = Network.TESTNET
  ) {
    this.network = network;
  }

  /**
   * Process transaction data from JSON RPC
   */
  async processTx(txData: any): Promise<BaseTx> {
    try {
      this.validateTxData(txData);
      
      const { hash, height, tx, tx_result } = txData;
      const decodedTx = this.decodeTxData(tx);
      
      // Create message type and meta information
      const { mainMessageType, meta } = this.extractMessageInfo(decodedTx);
      
      // Determine TX status
      const status = this.determineTxStatus(tx_result);
      
      // Create base TX information
      const baseTx = this.createBaseTx(
        hash, 
        height, 
        status, 
        decodedTx, 
        mainMessageType, 
        meta
      );

      // Save to database
      await this.txStorage.saveTx(baseTx, this.network);
      
      return baseTx;
    } catch (error) {
      return this.handleProcessingError(error, 'TX processing error');
    }
  }

  /**
   * Process transaction data from Websocket
   */
  async processTxFromWebsocket(txEvent: WebsocketTxEvent): Promise<BaseTx> {
    try {
      this.validateTxEvent(txEvent);
      
      const txResult = txEvent.data.value.TxResult;
      const txHash = txEvent.events['tx.hash'][0];
      const height = txResult.height;
      
      // Prepare TX data
      const txData = {
        hash: txHash,
        height,
        tx: txResult.tx,
        tx_result: txResult.result
      };
      
      return this.processTx(txData);
    } catch (error) {
      return this.handleProcessingError(error, 'Websocket TX processing error');
    }
  }

  /**
   * Get transaction information by hash
   */
  async getTxByHash(txHash: string): Promise<BaseTx | null> {
    return this.txStorage.getTxByHash(txHash, this.network);
  }

  /**
   * Get transaction details by hash
   */
  async getTxDetailByHash(txHash: string): Promise<any> {
    try {
      // First check in database
      const storedTx = await this.txStorage.getTxByHash(txHash, this.network);
      
      if (!storedTx) {
        return await this.fetchAndProcessTxDetails(txHash);
      }
      
      // Get full unreduced details
      if (storedTx.meta && storedTx.meta.length > 0) {
        return {
          tx: storedTx,
          details: await this.fetchTxDetails(txHash)
        };
      }
      
      return storedTx;
    } catch (error) {
      return this.handleProcessingError(error, 'Error getting TX details');
    }
  }

  /**
   * Decode transaction data
   */
  private decodeTxData(tx: any): any {
    const decodedTx = decodeTx(tx);
    
    if (!decodedTx || decodedTx.error) {
      throw new TxProcessorError(`TX decode error: ${decodedTx?.error || 'Unknown error'}`);
    }
    
    return decodedTx;
  }

  /**
   * Extract message type and meta information
   */
  private extractMessageInfo(decodedTx: any): { mainMessageType: string, meta: TxMessage[] } {
    // Determine message type (type of first message)
    const mainMessageType = decodedTx.messages.length > 0 
      ? decodedTx.messages[0].typeUrl 
      : 'unknown';
    
    // Create meta information
    const meta: TxMessage[] = decodedTx.messages.map((msg: any) => ({
      typeUrl: msg.typeUrl,
      content: msg.content
    }));
    
    return { mainMessageType, meta };
  }

  /**
   * Determine transaction status
   */
  private determineTxStatus(txResult: any): TxStatus {
    return !txResult.code 
      ? TxStatus.SUCCESS 
      : (txResult.code !== 0 ? TxStatus.FAILED : TxStatus.SUCCESS);
  }

  /**
   * Create base TX information
   */
  private createBaseTx(
    hash: string, 
    height: string | number, 
    status: TxStatus, 
    decodedTx: any, 
    messageType: string, 
    meta: TxMessage[]
  ): BaseTx {
    return {
      txHash: hash,
      height: height.toString(),
      status,
      fee: this.extractFeeInfo(decodedTx),
      messageCount: decodedTx.messages.length,
      type: messageType,
      time: new Date().toISOString(), // TX time usually comes from block, but not available here
      meta
    };
  }

  /**
   * Extract fee information
   */
  private extractFeeInfo(decodedTx: any): { amount: any[], gasLimit: string } {
    return decodedTx.tx?.authInfo?.fee 
      ? {
          amount: decodedTx.tx.authInfo.fee.amount,
          gasLimit: decodedTx.tx.authInfo.fee.gasLimit.toString()
        } 
      : {
          amount: [],
          gasLimit: '0'
        };
  }

  /**
   * Fetch and process TX details via RPC
   */
  private async fetchAndProcessTxDetails(txHash: string): Promise<any> {
    const txDetail = await this.fetchTxDetails(txHash);
    
    if (!txDetail) {
      throw new TxProcessorError(`TX not found: ${txHash}`);
    }
    
    return txDetail;
  }

  /**
   * Handle processing errors
   */
  private handleProcessingError(error: unknown, prefix: string): never {
    if (error instanceof TxProcessorError) {
      throw error;
    }
    throw new TxProcessorError(
      `${prefix}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Set network value
   */
  setNetwork(network: Network): void {
    this.network = network;
  }

  /**
   * Get current network value
   */
  getNetwork(): Network {
    return this.network;
  }

  /**
   * Validate transaction data
   */
  private validateTxData(txData: any): void {
    if (!txData || !txData.hash || !txData.tx) {
      throw new TxProcessorError('Invalid TX data');
    }
  }

  /**
   * Validate websocket event data
   */
  private validateTxEvent(txEvent: WebsocketTxEvent): void {
    if (!txEvent?.data?.value?.TxResult || !txEvent.events?.['tx.hash']?.[0]) {
      throw new TxProcessorError('Invalid websocket TX event data');
    }
  }
}