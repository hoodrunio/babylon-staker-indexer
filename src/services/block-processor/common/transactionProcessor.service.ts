/**
 * Transaction işleme servisi
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
   * JSON RPC'den gelen transaction verisini işler
   */
  async processTx(txData: any): Promise<BaseTx> {
    try {
      const { hash, height, tx, tx_result } = txData;

      // TX'i decode et
      const decodedTx = decodeTx(tx);
      
      if (!decodedTx || decodedTx.error) {
        throw new TxProcessorError(`TX decode hatası: ${decodedTx?.error || 'Bilinmeyen hata'}`);
      }

      // Mesaj tipini belirle (ilk mesajın tipi)
      const mainMessageType = decodedTx.messages.length > 0 ? decodedTx.messages[0].typeUrl : 'unknown';
      
      // TX durumunu belirle
      const status = !tx_result.code ? TxStatus.SUCCESS : (tx_result.code !== 0 ? TxStatus.FAILED : TxStatus.SUCCESS);
      
      // Meta bilgisini oluştur
      const meta: TxMessage[] = decodedTx.messages.map(msg => ({
        typeUrl: msg.typeUrl,
        content: msg.content
      }));

      // Temel TX bilgilerini oluştur
      const baseTx: BaseTx = {
        txHash: hash,
        height: height.toString(),
        status,
        fee: decodedTx.tx?.authInfo?.fee ? {
          amount: decodedTx.tx.authInfo.fee.amount,
          gasLimit: decodedTx.tx.authInfo.fee.gasLimit.toString()
        } : {
          amount: [],
          gasLimit: '0'
        },
        messageCount: decodedTx.messages.length,
        type: mainMessageType,
        time: new Date().toISOString(), // TX zamanı genellikle bloktan alınır, ama burada yok
        meta
      };

      // Veritabanına kaydet
      await this.txStorage.saveTx(baseTx, this.network);
      
      return baseTx;
    } catch (error) {
      if (error instanceof TxProcessorError) {
        throw error;
      }
      throw new TxProcessorError(`TX işleme hatası: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Websocket'ten gelen transaction verisini işler
   */
  async processTxFromWebsocket(txEvent: WebsocketTxEvent): Promise<BaseTx> {
    try {
      const txResult = txEvent.data.value.TxResult;
      const txHash = txEvent.events['tx.hash'][0];
      const height = txResult.height;
      
      // TX verisini hazırla
      const txData = {
        hash: txHash,
        height,
        tx: txResult.tx,
        tx_result: txResult.result
      };
      
      return this.processTx(txData);
    } catch (error) {
      throw new TxProcessorError(`Websocket TX işleme hatası: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Hash değerine göre transaction bilgisini getirir
   */
  async getTxByHash(txHash: string): Promise<BaseTx | null> {
    return this.txStorage.getTxByHash(txHash, this.network);
  }

  /**
   * Hash değerine göre transaction detayını getirir
   */
  async getTxDetailByHash(txHash: string): Promise<any> {
    // Önce veritabanında kontrol et
    const storedTx = await this.txStorage.getTxByHash(txHash, this.network);
    
    if (!storedTx) {
      // Veritabanında yoksa, RPC üzerinden getir
      const txDetail = await this.fetchTxDetails(txHash);
      
      if (!txDetail) {
        throw new TxProcessorError(`TX bulunamadı: ${txHash}`);
      }
      
      return txDetail;
    }
    
    // İndirgenmemiş tüm detayı getir
    if (storedTx.meta && storedTx.meta.length > 0) {
      return {
        tx: storedTx,
        details: await this.fetchTxDetails(txHash)
      };
    }
    
    return storedTx;
  }

  /**
   * Network değerini ayarlar
   */
  setNetwork(network: Network): void {
    this.network = network;
  }

  /**
   * Mevcut network değerini döndürür
   */
  getNetwork(): Network {
    return this.network;
  }
} 