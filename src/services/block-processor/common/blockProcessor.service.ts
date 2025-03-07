/**
 * Block işleme servisi
 */

import { BaseBlock, BlockProcessorError, SignatureInfo, WebsocketBlockEvent } from '../types/common';
import { IBlockProcessorService, IBlockStorage } from '../types/interfaces';
import { Network } from '../../../types/finality';
import { BabylonClient } from '../../../clients/BabylonClient';
import { logger } from '../../../utils/logger';
import { ValidatorInfoService } from '../../validator/ValidatorInfoService';
export class BlockProcessorService implements IBlockProcessorService {
  private network: Network;
  private babylonClient: BabylonClient;
  private validatorInfoService: ValidatorInfoService;
  constructor(
    private readonly blockStorage: IBlockStorage, 
    network: Network = Network.TESTNET,
    babylonClient?: BabylonClient
  ) {
    this.network = network;
    this.babylonClient = babylonClient || BabylonClient.getInstance(network);
    this.validatorInfoService = ValidatorInfoService.getInstance();
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
      
      // Önce proposer validator bilgisini alalım
      const proposerValidator = await this.validatorInfoService.getValidatorByHexAddress(header.proposer_address, this.network);
      if (!proposerValidator) {
        throw new BlockProcessorError(`Proposer validator bulunamadı: ${header.proposer_address}`);
      }
      
      // İmzaları işleyelim
      const signaturesPromises = blockData.last_commit?.signatures.map(async (sig: any) => {
        if (!sig.validator_address) {
          return null; // Geçersiz imzaları atlayalım
        }
        
        const validator = await this.validatorInfoService.getValidatorByHexAddress(sig.validator_address, this.network);
        if (!validator) {
          return null; // Validator bulunamadıysa atlayalım
        }
        
        return {
          validator: validator._id,
          timestamp: sig.timestamp || '',
          signature: sig.signature || ''
        };
      }) || [];
      
      // Promise'ları çözümleyelim ve null olanları filtreleyelim
      const signatures = (await Promise.all(signaturesPromises)).filter(sig => sig !== null);
      const height = parseInt(blockData.header.height);
      
      // Doğrudan RPC çağrısı yapalım
      const response = await this.babylonClient.getBlockByHeight(height);
      if (response) {
        // Hash değerini ekle
        const hash = response.result.block_id.hash;
        blockData.block_id = {
          hash: hash
        };
      }
      const blockhash = blockData.block_id?.hash || '';
      const baseBlock: BaseBlock = {
        height: header.height,
        blockHash: blockhash,
        proposer: proposerValidator._id,
        numTxs: Array.isArray(blockData.data?.txs) ? blockData.data.txs.length : 0,
        time: header.time,
        signatures,
        appHash: header.app_hash
      };

      // Veritabanına kaydet
      await this.blockStorage.saveBlock(baseBlock, this.network);
      
      // Özet log kaydı
      logger.info(`[BlockProcessorService] Processed block at height ${baseBlock.height} with ${baseBlock.numTxs} transactions`);
      
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
      // Blok verilerini kontrol et
      if (!blockEvent?.data?.value?.block) {
        throw new BlockProcessorError('Block data is missing in websocket event');
      }

      const blockData = blockEvent.data.value.block;
      
      // Header kontrolü
      if (!blockData.header) {
        throw new BlockProcessorError('Block header bulunamadı');
      }
      
      const height = parseInt(blockData.header.height);
      
      // Doğrudan RPC çağrısı yapalım
      const response = await this.babylonClient.getBlockByHeight(height);
      //logger.info(`[BlockProcessorService] Block hash: ${response.result.block_id.hash}`);
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