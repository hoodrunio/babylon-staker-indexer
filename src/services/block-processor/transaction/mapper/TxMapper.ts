/**
 * Transaction Mapper
 * Handles mapping between different transaction data formats
 */

import { BaseTx, SimpleTx, TxMessage, TxStatus } from '../../types/common';
import { ITransaction } from '../../../../database/models/blockchain/Transaction';
import { logger } from '../../../../utils/logger';

export class TxMapper {
  /**
   * Maps ITransaction model to BaseTx
   */
  public static mapToBaseTx(tx: ITransaction): BaseTx {
    const baseTx: BaseTx = {
      txHash: tx.txHash,
      height: tx.height,
      status: tx.status as TxStatus,
      fee: tx.fee,
      messageCount: tx.messageCount,
      type: tx.type,
      time: tx.time,
      meta: tx.meta as TxMessage[]
    };
    
    // Add reason for failed transactions
    if (tx.status === TxStatus.FAILED && tx.reason) {
      baseTx.reason = tx.reason;
    }
    
    return baseTx;
  }
  
  /**
   * Maps ITransaction model to BaseTx for block view (without meta data)
   */
  public static mapToBlockTx(tx: ITransaction): BaseTx {
    const baseTx: BaseTx = {
      txHash: tx.txHash,
      height: tx.height,
      status: tx.status as TxStatus,
      fee: tx.fee,
      messageCount: tx.messageCount,
      type: tx.type,
      time: tx.time,
    };
    
    // Add reason for failed transactions
    if (tx.status === TxStatus.FAILED && tx.reason) {
      baseTx.reason = tx.reason;
    }
    
    return baseTx;
  }
  
  /**
   * Maps ITransaction to SimpleTx
   */
  public static mapToSimpleTx(tx: ITransaction): SimpleTx {
    return {
      txHash: tx.txHash,
      height: tx.height,
      status: tx.status as TxStatus,
      type: tx.type,
      firstMessageType: tx.firstMessageType || 'unknown',
      time: tx.time,
      messageCount: tx.messageCount
    };
  }
  
  /**
   * Converts raw transaction data from blockchain to BaseTx format
   */
  public static convertRawTxToBaseTx(rawTx: any): BaseTx {
    try {
      // Extract basic information
      const txHash = rawTx.tx_response.txhash || '';
      const height = rawTx.tx_response.height?.toString() || '0';
      
      // Determine status
      const status = rawTx.tx_response.code === 0
        ? TxStatus.SUCCESS
        : TxStatus.FAILED;
      
      // Extract fee information
      const fee = {
        amount: rawTx.tx?.auth_info?.fee?.amount?.[0] ? [{
          denom: rawTx.tx.auth_info.fee.amount[0].denom || '',
          amount: rawTx.tx.auth_info.fee.amount[0].amount || '0'
        }] : [],
        gasLimit: rawTx.tx?.auth_info?.fee?.gas_limit?.toString() || '0'
      };
      
      // Extract message information
      const messages = rawTx.tx?.body?.messages || [];
      const messageCount = messages.length;
      
      // Determine main message type
      const type = messageCount > 0 ? messages[0]['@type'] || 'unknown' : 'unknown';
      
      // Create meta information
      const meta: TxMessage[] = messages.map((msg: any) => ({
        typeUrl: msg['@type'] || 'unknown',
        content: msg
      }));
      
      // Use timestamp if available, otherwise current time
      const time = rawTx.timestamp || new Date().toISOString();
      
      // Create base transaction object
      const baseTx: BaseTx = {
        txHash,
        height,
        status,
        fee,
        messageCount,
        type,
        time,
        meta
      };
      
      // Add reason for failed transactions
      if (status === TxStatus.FAILED && rawTx.tx_response.raw_log) {
        baseTx.reason = rawTx.tx_response.raw_log;
      }
      
      return baseTx;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[TxMapper] Error converting raw tx to BaseTx: ${errorMessage}`);
      throw new Error(`Failed to convert raw transaction: ${errorMessage}`);
    }
  }
  
  /**
   * Extracts first message type from transaction
   */
  public static extractFirstMessageType(tx: BaseTx): string {
    let firstMessageType = 'unknown';
    
    if (tx.meta && tx.meta.length > 0) {
      const firstMeta = tx.meta[0];
      if (firstMeta.content) {
        if (firstMeta.content.msg) {
          // Try to get first key from msg object
          const msgKeys = Object.keys(firstMeta.content.msg);
          if (msgKeys.length > 0) {
            firstMessageType = msgKeys[0];
          }
        } else if (firstMeta.content['@type']) {
          // If no msg but has @type, use that
          firstMessageType = firstMeta.content['@type'];
        }
      }
    }
    
    return firstMessageType;
  }
  
  /**
   * Converts tx_search result format to BaseTx format
   */
  public static async convertTxSearchResultToBaseTx(rawTx: any, blockTime: string): Promise<BaseTx> {
    try {
      if (!rawTx) {
        throw new Error('Invalid transaction: rawTx is null or undefined');
      }
      
      if (!rawTx.hash) {
        throw new Error('Invalid transaction format: missing hash');
      }

      // Extract basic information
      const txHash = rawTx.hash || '';
      const height = rawTx.height?.toString() || '0';
      
      // Determine status from tx_result.code
      const status = rawTx.tx_result?.code === 0
        ? TxStatus.SUCCESS
        : TxStatus.FAILED;
      
      // Extract fee information from events
      const feeInfo = TxMapper.extractFeeFromEvents(rawTx);
      
      // Extract message type and count from events
      const { messageType, messageCount } = TxMapper.extractMessageInfoFromEvents(rawTx, txHash);
      
      // Create minimal meta information - just empty array as we don't need details
      const meta: TxMessage[] = [];
      
      // Create base transaction object
      const baseTx: BaseTx = {
        txHash,
        height,
        status,
        fee: feeInfo,
        messageCount: Math.max(1, messageCount), // At least 1 message
        type: messageType,
        time: blockTime,
        meta // Empty array for minimal response
      };
      
      // Add reason for failed transactions
      if (status === TxStatus.FAILED && rawTx.tx_result?.log) {
        baseTx.reason = rawTx.tx_result.log;
      }
      
      return baseTx;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[TxMapper] Error converting tx_search result to BaseTx: ${errorMessage}`);
      throw new Error(`Failed to convert tx_search result: ${errorMessage}`);
    }
  }
  
  /**
   * Extract fee information from transaction events
   */
  private static extractFeeFromEvents(rawTx: any): { amount: { denom: string, amount: string }[], gasLimit: string } {
    let feeAmount = '0';
    let feeDenom = 'ubbn';
    let gasWanted = '0';
    
    // Try to find fee information in events
    if (rawTx.tx_result?.events) {
      for (const event of rawTx.tx_result.events) {
        if (event.type === 'tx' && event.attributes) {
          for (const attr of event.attributes) {
            if (attr.key === 'fee') {
              // Fee format is typically "10869ubbn"
              const feeValue = attr.value || '';
              const match = feeValue.match(/(\d+)(\D+)/);
              if (match) {
                feeAmount = match[1];
                feeDenom = match[2];
              }
              break;
            }
          }
        }
      }
    }
    
    // Get gas_wanted from tx_result if available
    if (rawTx.tx_result?.gas_wanted) {
      gasWanted = rawTx.tx_result.gas_wanted.toString();
    }
    
    return {
      amount: [{
        denom: feeDenom,
        amount: feeAmount
      }],
      gasLimit: gasWanted
    };
  }
  
  /**
   * Extract message type and count from transaction events
   */
  private static extractMessageInfoFromEvents(rawTx: any, txHash: string): { messageType: string, messageCount: number } {
    let messageType = 'unknown';
    let messageCount = 0;
    let messageEvents = [];
    
    // First, collect all message events
    if (rawTx.tx_result?.events) {
      messageEvents = rawTx.tx_result.events.filter((event: any) => 
        event.type === 'message' && 
        event.attributes && 
        event.attributes.some((attr: any) => attr.key === 'action')
      );
    }
    
    // Then process them
    if (messageEvents.length > 0) {
      messageCount = messageEvents.length;
      
      // Get the first message event with an action attribute
      const firstMessageEvent = messageEvents[0];
      const actionAttr = firstMessageEvent.attributes.find((attr: { key: string, value: string }) => attr.key === 'action');
      
      if (actionAttr && actionAttr.value) {
        messageType = actionAttr.value;
      }
    } else {
      logger.warn(`[TxMapper] No message events with action found for tx ${txHash}`);
    }
    
    return { messageType, messageCount };
  }
} 