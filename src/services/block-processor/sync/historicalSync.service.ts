/**
 * Historical block and transaction synchronization service
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
  private babylonClient: BabylonClient;
  private readonly MAX_BLOCK_SYNC = 10;
  private blockHandler: BlockTransactionHandler;
  private blockStorage: BlockStorage;
  
  private constructor() {
    // Get BlockTransactionHandler singleton instance
    this.blockHandler = BlockTransactionHandler.getInstance();
    // Get BlockStorage singleton instance
    this.blockStorage = BlockStorage.getInstance();
    
    try {
      // Initialize BabylonClient using the network from environment variable
      this.babylonClient = BabylonClient.getInstance();
      const network = this.babylonClient.getNetwork();
      logger.info(`[HistoricalSync] Client initialized successfully for network: ${network}`);
    } catch (error) {
      logger.error('[HistoricalSync] Failed to initialize BabylonClient:', error);
      throw new Error('[HistoricalSync] Failed to initialize BabylonClient. Please check your NETWORK environment variable.');
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
   * Starts periodic updates
   */
  private startPeriodicUpdates(): void {
    // Periodic update logic can be added here
    logger.info('[HistoricalSync] Periodic updates initialized');
  }

  /**
   * Main synchronization method - Main method to be called externally
   * Determines synchronization strategy based on database state
   * @param network Network information (MAINNET, TESTNET)
   * @param fromHeight Starting block height (optional)
   * @param blockCount Number of blocks to synchronize (optional)
   */
  public async startSync(network: Network, fromHeight?: number, blockCount?: number): Promise<void> {
    try {
      logger.info(`[HistoricalSync] Starting sync for network ${network}...`);
      
      // If fromHeight is specified, synchronize from that height
      if (fromHeight) {
        logger.info(`[HistoricalSync] Starting sync from specified height ${fromHeight}`);
        try {
          await this.syncFromHeight(fromHeight, undefined, network);
        } catch (error) {
          logger.error(`[HistoricalSync] Error syncing from height ${fromHeight}: ${error instanceof Error ? error.message : String(error)}`);
          // In case of error, try to synchronize last N blocks
          const count = blockCount || this.MAX_BLOCK_SYNC;
          logger.info(`[HistoricalSync] Falling back to syncing latest ${count} blocks`);
          await this.syncLatestBlocks(count, network);
        }
        return;
      }
      
      // Check the latest block in database
      try {
        const latestBlock = await this.blockStorage.getLatestBlock(network);
        
        if (latestBlock) {
          // If block exists in database, sync from last block
          const lastHeight = Number(latestBlock.height);
          logger.info(`[HistoricalSync] Found latest block in database at height ${lastHeight}, syncing from there`);
          await this.syncFromHeight(lastHeight + 1, undefined, network);
        } else {
          // If database is empty, sync last N blocks
          const count = blockCount || this.MAX_BLOCK_SYNC;
          logger.info(`[HistoricalSync] No blocks found in database, syncing latest ${count} blocks`);
          await this.syncLatestBlocks(count, network);
        }
      } catch (dbError) {
        // In case of database error, sync last N blocks
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
   * Synchronizes blocks starting from a specific height
   */
  async syncFromHeight(fromHeight: number, toHeight?: number, network?: Network): Promise<void> {
    if (this.isSyncing) {
      logger.warn('[HistoricalSync] Synchronization already in progress');
      return;
    }

    this.isSyncing = true;
    
    try {
      // Use the network parameter if provided, otherwise get from client
      const networkToUse = network || this.babylonClient.getNetwork();
      
      logger.info(`[HistoricalSync] Starting synchronization from height ${fromHeight} for network ${networkToUse}`);
      
      // Synchronize using BlockTransactionHandler
      await this.blockHandler.syncHistoricalBlocks(networkToUse, fromHeight, toHeight);
    } catch (error) {
      logger.error(`[HistoricalSync] Synchronization error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Synchronizes last N blocks
   */
  async syncLatestBlocks(blockCount = this.MAX_BLOCK_SYNC, network?: Network): Promise<void> {
    try {
      // Use the network parameter if provided, otherwise get from client
      const networkToUse = network || this.babylonClient.getNetwork();
      
      logger.info(`[HistoricalSync] Synchronizing latest ${blockCount} blocks for network ${networkToUse}`);
      
      // Synchronize latest blocks using BlockTransactionHandler
      await this.blockHandler.syncLatestBlocks(networkToUse, blockCount);
    } catch (error) {
      logger.error(`[HistoricalSync] Error synchronizing latest blocks: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Returns the BabylonClient instance
   */
  public getBabylonClient(): BabylonClient {
    return this.babylonClient;
  }

  /**
   * Returns the configured network
   */
  public getConfiguredNetwork(): Network {
    return this.babylonClient.getNetwork();
  }
} 