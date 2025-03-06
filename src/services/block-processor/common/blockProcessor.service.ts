/**
 * Block işleme servisi
 */

import { BaseBlock, BlockProcessorError, SignatureInfo, WebsocketBlockEvent } from '../types/common';
import { IBlockProcessorService, IBlockStorage } from '../types/interfaces';
import { Network } from '../../../types/finality';
import { BabylonClient } from '../../../clients/BabylonClient';
import { logger } from '../../../utils/logger';

export class BlockProcessorService implements IBlockProcessorService {
  private network: Network;
  private babylonClient: BabylonClient;

  constructor(
    private readonly blockStorage: IBlockStorage, 
    network: Network = Network.TESTNET,
    babylonClient?: BabylonClient
  ) {
    this.network = network;
    this.babylonClient = babylonClient || BabylonClient.getInstance(network);
  }

  /**
   * JSON RPC'den gelen block verisini işler
   */
  async processBlock(blockData: any): Promise<BaseBlock> {
    try {
      const header = blockData.header;
      
      if (!header) {
        throw new BlockProcessorError('Block header bulunamadı');
      }

      const signatures = blockData.last_commit?.signatures.map((sig: any) => ({
        validatorAddress: sig.validator_address,
        timestamp: sig.timestamp,
        signature: sig.signature ? true : false
      })) || [];

      const baseBlock: BaseBlock = {
        height: header.height,
        blockHash: blockData.block_id?.hash || '',
        proposerAddress: header.proposer_address,
        numTxs: Array.isArray(blockData.data?.txs) ? blockData.data.txs.length : 0,
        time: header.time,
        signatures,
        appHash: header.app_hash
      };

      // Veritabanına kaydet
      await this.blockStorage.saveBlock(baseBlock, this.network);
      
      return baseBlock;
    } catch (error) {
      if (error instanceof BlockProcessorError) {
        throw error;
      }
      throw new BlockProcessorError(`Block işleme hatası: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Websocket'ten gelen block verisini işler
   */
  async processBlockFromWebsocket(blockEvent: WebsocketBlockEvent): Promise<BaseBlock> {
    try {
      const blockData = blockEvent.data.value.block;
      const height = parseInt(blockData.header.height);
      
          // Doğrudan RPC çağrısı yapalım
          const response = await this.babylonClient.getBlockByHeight(height);
          logger.info(`[BlockProcessorService] Block hash: ${response.result.block_id.hash}`);
          if (response) {
            // Hash değerini ekle
            const hash = response.result.block_id.hash;
            blockData.block_id = {
              hash: hash
            };
          } else {
            throw new BlockProcessorError(`Block hash bilgisi alınamadı: ${height}`);
      }
      
      return this.processBlock(blockData);
    } catch (error) {
      throw new BlockProcessorError(`Websocket block işleme hatası: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Belirli bir yüksekliğe sahip bloğu getirir
   */
  async getBlockByHeight(height: string | number): Promise<BaseBlock | null> {
    return this.blockStorage.getBlockByHeight(height, this.network);
  }
  
  /**
   * Hash değerine göre bloğu getirir
   */
  async getBlockByHash(blockHash: string): Promise<BaseBlock | null> {
    return this.blockStorage.getBlockByHash(blockHash, this.network);
  }

  /**
   * Network değerini ayarlar
   */
  setNetwork(network: Network): void {
    this.network = network;
    this.babylonClient = BabylonClient.getInstance(network);
  }

  /**
   * Mevcut network değerini döndürür
   */
  getNetwork(): Network {
    return this.network;
  }
} 