import { logger } from '../../utils/logger';
import { CosmWasmIndexerService } from './indexer.service';
import dotenv from 'dotenv';

dotenv.config();
/**
 * Service for scheduling periodic indexing of CosmWasm data
 */
export class CosmWasmScheduler {
  private intervalId?: NodeJS.Timeout;
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
  public start(): void {
    if (this.isRunning) {
      logger.info('CosmWasm scheduler is already running');
      return;
    }

    if (process.env.COSMWASM_INDEXER_ENABLED !== 'true') {
      logger.info('CosmWasm indexer is disabled in configuration');
      return;
    }

    const interval = parseInt(process.env.COSMWASM_INDEX_INTERVAL || '300000', 10); // Default to 5 minutes if not specified
    
    logger.info(`Starting CosmWasm scheduler with interval of ${interval}ms`);
    
    // Run initial indexing immediately
    this.runIndexing();
    
    // Schedule periodic indexing
    this.intervalId = setInterval(() => this.runIndexing(), interval);
    this.isRunning = true;
  }

  /**
   * Stop the CosmWasm scheduler
   */
  public stop(): void {
    if (!this.isRunning || !this.intervalId) {
      logger.info('CosmWasm scheduler is not running');
      return;
    }
    
    clearInterval(this.intervalId);
    this.intervalId = undefined;
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
   * Run a single indexing cycle
   */
  private async runIndexing(): Promise<void> {
    try {
      logger.info('Running scheduled CosmWasm indexing cycle');
      await this.indexerService.indexAllCosmWasmData();
      logger.info('Completed scheduled CosmWasm indexing cycle');
    } catch (error) {
      logger.error('Error during scheduled CosmWasm indexing:', error);
      // Don't stop the scheduler on error, we'll try again next cycle
    }
  }

  /**
   * Run a manual indexing cycle - useful for testing or on-demand updates
   */
  public async runManualIndexing(): Promise<void> {
    logger.info('Running manual CosmWasm indexing cycle');
    return this.runIndexing();
  }
}
