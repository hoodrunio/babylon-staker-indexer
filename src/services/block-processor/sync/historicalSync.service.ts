/**
 * Geçmiş blok ve işlem senkronizasyonu servisi
 */
  
import { IHistoricalSyncService } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { Network } from '../../../types/finality';
import { BabylonClient } from '../../../clients/BabylonClient';
import { BlockTransactionHandler } from '../handlers/BlockTransactionHandler';
import { BlockStorage } from '../storage/BlockStorage';

export class HistoricalSyncService implements IHistoricalSyncService {
  private static instance: HistoricalSyncService | null = null;
  private isSyncing = false;
  private babylonClients: Map<Network, BabylonClient> = new Map();
  private readonly MAX_BLOCK_SYNC = 10;
  private blockHandler: BlockTransactionHandler;
  private blockStorage: BlockStorage;
  
  private constructor() {
    // BlockTransactionHandler singleton instance'ını al
    this.blockHandler = BlockTransactionHandler.getInstance();
    // BlockStorage singleton instance'ını al
    this.blockStorage = BlockStorage.getInstance();
    
    try {
      this.babylonClients.set(Network.MAINNET, BabylonClient.getInstance(Network.MAINNET));
      logger.info('[HistoricalSync] Mainnet client initialized successfully');
    } catch (error) {
      logger.warn('[HistoricalSync] Mainnet is not configured, skipping');
    }

    try {
      this.babylonClients.set(Network.TESTNET, BabylonClient.getInstance(Network.TESTNET));
      logger.info('[HistoricalSync] Testnet client initialized successfully');
    } catch (error) {
      logger.warn('[HistoricalSync] Testnet is not configured, skipping');
    }

    if (this.babylonClients.size === 0) {
      throw new Error('[HistoricalSync] No network configurations found. Please configure at least one network.');
    }

    // Start periodic updates only if not in test environment
    if (process.env.NODE_ENV !== 'test') {
      this.startPeriodicUpdates();
    }
  }

  /**
   * Singleton instance
   */
  public static getInstance(): HistoricalSyncService {
    if (!HistoricalSyncService.instance) {
      HistoricalSyncService.instance = new HistoricalSyncService();
    }
    return HistoricalSyncService.instance;
  }

  /**
   * Periyodik güncellemeleri başlatır
   */
  private startPeriodicUpdates(): void {
    // Burada periyodik güncelleme mantığı eklenebilir
    logger.info('[HistoricalSync] Periodic updates initialized');
  }

  /**
   * Ana senkronizasyon metodu - Dışarıdan çağrılacak ana metot
   * Veritabanı durumuna göre senkronizasyon stratejisini belirler
   * @param network Ağ bilgisi (MAINNET, TESTNET)
   * @param fromHeight Başlangıç blok yüksekliği (opsiyonel)
   * @param blockCount Senkronize edilecek blok sayısı (opsiyonel)
   */
  public async startSync(network: Network, fromHeight?: number, blockCount?: number): Promise<void> {
    try {
      logger.info(`[HistoricalSync] Starting sync for network ${network}...`);
      
      // Eğer fromHeight belirtilmişse, o yükseklikten itibaren senkronize et
      if (fromHeight) {
        logger.info(`[HistoricalSync] Starting sync from specified height ${fromHeight}`);
        try {
          await this.syncFromHeight(fromHeight, undefined, network);
        } catch (error) {
          logger.error(`[HistoricalSync] Error syncing from height ${fromHeight}: ${error instanceof Error ? error.message : String(error)}`);
          // Hata durumunda son N bloğu senkronize etmeyi dene
          const count = blockCount || this.MAX_BLOCK_SYNC;
          logger.info(`[HistoricalSync] Falling back to syncing latest ${count} blocks`);
          await this.syncLatestBlocks(count, network);
        }
        return;
      }
      
      // Veritabanındaki son bloğu kontrol et
      try {
        const latestBlock = await this.blockStorage.getLatestBlock(network);
        
        if (latestBlock) {
          // Veritabanında blok varsa, son bloktan itibaren senkronize et
          const lastHeight = Number(latestBlock.height);
          logger.info(`[HistoricalSync] Found latest block in database at height ${lastHeight}, syncing from there`);
          await this.syncFromHeight(lastHeight + 1, undefined, network);
        } else {
          // Veritabanı boşsa, son N bloğu senkronize et
          const count = blockCount || this.MAX_BLOCK_SYNC;
          logger.info(`[HistoricalSync] No blocks found in database, syncing latest ${count} blocks`);
          await this.syncLatestBlocks(count, network);
        }
      } catch (dbError) {
        // Veritabanı hatası durumunda son N bloğu senkronize et
        logger.error(`[HistoricalSync] Error accessing database: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        const count = blockCount || this.MAX_BLOCK_SYNC;
        logger.info(`[HistoricalSync] Falling back to syncing latest ${count} blocks`);
        await this.syncLatestBlocks(count, network);
      }
    } catch (error) {
      logger.error(`[HistoricalSync] Error during sync: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Belirli bir yükseklikten başlayarak blokları senkronize eder
   */
  async syncFromHeight(fromHeight: number, toHeight?: number, network?: Network): Promise<void> {
    if (this.isSyncing) {
      logger.warn('[HistoricalSync] Synchronization already in progress');
      return;
    }

    this.isSyncing = true;
    
    try {
      // Eğer network belirtilmemişse, tüm yapılandırılmış networkler için senkronizasyon yap
      const networksToSync = network ? [network] : Array.from(this.babylonClients.keys());
      
      for (const currentNetwork of networksToSync) {
        const babylonClient = this.getBabylonClient(currentNetwork);
        if (!babylonClient) {
          logger.warn(`[HistoricalSync] Network ${currentNetwork} is not configured, skipping`);
          continue;
        }
        
        logger.info(`[HistoricalSync] Starting synchronization from height ${fromHeight} for network ${currentNetwork}`);
        
        // BlockTransactionHandler'ı kullanarak senkronizasyon yap
        await this.blockHandler.syncHistoricalBlocks(currentNetwork, fromHeight, toHeight);
      }
    } catch (error) {
      logger.error(`[HistoricalSync] Synchronization error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Son N bloğu senkronize eder
   */
  async syncLatestBlocks(blockCount = this.MAX_BLOCK_SYNC, network?: Network): Promise<void> {
    try {
      // Eğer network belirtilmemişse, tüm yapılandırılmış networkler için senkronizasyon yap
      const networksToSync = network ? [network] : Array.from(this.babylonClients.keys());
      
      for (const currentNetwork of networksToSync) {
        const babylonClient = this.getBabylonClient(currentNetwork);
        if (!babylonClient) {
          logger.warn(`[HistoricalSync] Network ${currentNetwork} is not configured, skipping`);
          continue;
        }
        
        logger.info(`[HistoricalSync] Synchronizing latest ${blockCount} blocks for network ${currentNetwork}`);
        
        // BlockTransactionHandler'ı kullanarak son blokları senkronize et
        await this.blockHandler.syncLatestBlocks(currentNetwork, blockCount);
      }
    } catch (error) {
      logger.error(`[HistoricalSync] Error synchronizing latest blocks: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Belirtilen ağ için BabylonClient örneğini döndürür
   */
  public getBabylonClient(network: Network): BabylonClient | undefined {
    return this.babylonClients.get(network);
  }

  /**
   * Yapılandırılmış tüm ağları döndürür
   */
  public getConfiguredNetworks(): Network[] {
    return Array.from(this.babylonClients.keys());
  }
} 