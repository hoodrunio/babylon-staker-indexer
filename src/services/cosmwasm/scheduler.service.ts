import { logger } from '../../utils/logger';
import { CosmWasmIndexerService } from './indexer.service';
import { WasmState, IWasmState } from '../../database/models/cosmwasm';
import dotenv from 'dotenv';

dotenv.config();

// CosmWasm State document ID
const WASM_STATE_ID = 'cosmwasm_state';

/**
 * Service for scheduling periodic indexing of CosmWasm data
 */
export class CosmWasmScheduler {
  private fullIndexIntervalId?: NodeJS.Timeout;
  private incrementalIndexIntervalId?: NodeJS.Timeout;
  private isRunning = false;
  private indexerService: CosmWasmIndexerService;
  private static instance: CosmWasmScheduler | null = null;

  /**
   * Initialize CosmWasm scheduler
   */
  private constructor() {
    this.indexerService = CosmWasmIndexerService.getInstance();
  }

  /**
   * Get singleton instance of CosmWasmScheduler
   */
  public static getInstance(): CosmWasmScheduler {
    if (!CosmWasmScheduler.instance) {
      CosmWasmScheduler.instance = new CosmWasmScheduler();
    }
    return CosmWasmScheduler.instance;
  }

  /**
   * Start the CosmWasm scheduler
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.info('CosmWasm scheduler is already running');
      return;
    }

    if (process.env.COSMWASM_INDEXER_ENABLED !== 'true') {
      logger.info('CosmWasm indexer is disabled in configuration');
      return;
    }

    // Interval for full indexing (default: 24 hours)
    const fullIndexInterval = parseInt(process.env.COSMWASM_FULL_INDEX_INTERVAL || '86400000', 10);
    
    // Interval for incremental indexing (default: 5 minutes)
    const incrementalIndexInterval = parseInt(process.env.COSMWASM_INCREMENTAL_INDEX_INTERVAL || '300000', 10);
    
    logger.info(`Starting CosmWasm scheduler with full index interval of ${fullIndexInterval}ms (${fullIndexInterval / 3600000} hours)`);
    logger.info(`Starting CosmWasm scheduler with incremental index interval of ${incrementalIndexInterval}ms (${incrementalIndexInterval / 60000} minutes)`);
    
    // Check last indexing time for the first run
    const wasmState = await this.getWasmState();
    
    if (!wasmState || this.shouldPerformFullIndex(wasmState.lastFullIndexAt)) {
      // Perform full indexing if it's the first start or enough time has passed since the last full indexing
      logger.info('Running initial full CosmWasm indexing');
      await this.runFullIndexing();
    } else {
      // If a short time has passed since the last indexing, only perform incremental indexing
      logger.info('Running initial incremental CosmWasm indexing');
      await this.runIncrementalIndexing();
    }
    
    // Schedule periodic full indexing
    this.fullIndexIntervalId = setInterval(() => this.runFullIndexing(), fullIndexInterval);
    
    // Schedule periodic incremental indexing
    this.incrementalIndexIntervalId = setInterval(() => this.runIncrementalIndexing(), incrementalIndexInterval);
    
    this.isRunning = true;
  }

  /**
   * Determine if a full index should be performed based on last full index time
   */
  private shouldPerformFullIndex(lastFullIndexTime?: Date): boolean {
    if (!lastFullIndexTime) return true;
    
    const fullIndexInterval = parseInt(process.env.COSMWASM_FULL_INDEX_INTERVAL || '86400000', 10);
    const timeSinceLastFullIndex = Date.now() - lastFullIndexTime.getTime();
    
    return timeSinceLastFullIndex >= fullIndexInterval;
  }

  /**
   * Get the WasmState from database
   */
  private async getWasmState(): Promise<IWasmState | null> {
    try {
      return await WasmState.getOrCreate(WASM_STATE_ID);
    } catch (error) {
      logger.error('Error retrieving CosmWasm state:', error);
      return null;
    }
  }

  /**
   * Stop the CosmWasm scheduler
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.info('CosmWasm scheduler is not running');
      return;
    }
    
    if (this.fullIndexIntervalId) {
      clearInterval(this.fullIndexIntervalId);
      this.fullIndexIntervalId = undefined;
    }
    
    if (this.incrementalIndexIntervalId) {
      clearInterval(this.incrementalIndexIntervalId);
      this.incrementalIndexIntervalId = undefined;
    }
    
    this.isRunning = false;
    
    logger.info('Stopped CosmWasm scheduler');
  }

  /**
   * Check if the scheduler is currently running
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Run a full indexing cycle - indexes all codes and contracts
   */
  private async runFullIndexing(): Promise<void> {
    try {
      logger.info('Running full CosmWasm indexing cycle (all codes and contracts)');
      await this.indexerService.indexAllCosmWasmData();
      logger.info('Completed full CosmWasm indexing cycle');
    } catch (error) {
      logger.error('Error during full CosmWasm indexing:', error);
      // Don't stop the scheduler on error, we'll try again next cycle
    }
  }

  /**
   * Run an incremental indexing cycle - only check for changes in contracts
   */
  private async runIncrementalIndexing(): Promise<void> {
    try {
      logger.info('Running incremental CosmWasm indexing cycle (only contract changes)');
      
      // Use the new incremental indexing method
      await this.indexerService.indexContractChanges();
      
      logger.info('Completed incremental CosmWasm indexing cycle');
    } catch (error) {
      logger.error('Error during incremental CosmWasm indexing:', error);
      // Don't stop the scheduler on error, we'll try again next cycle
    }
  }

  /**
   * Run a manual indexing cycle - useful for testing or on-demand updates
   */
  public async runManualIndexing(): Promise<void> {
    logger.info('Running manual CosmWasm indexing cycle');
    return this.runFullIndexing();
  }
}
