import { CosmWasmIndexer } from './CosmWasmIndexer';
import { logger } from '../utils/logger';
import cron from 'node-cron';

/**
 * Scheduler for periodic CosmWasm data indexing
 */
export class CosmWasmScheduler {
  private readonly indexer: CosmWasmIndexer;
  private cronJob: cron.ScheduledTask | null = null;
  private readonly indexingInterval: string;
  
  private static instance: CosmWasmScheduler | null = null;

  /**
   * Initialize CosmWasm scheduler
   * @param indexingInterval Cron expression for indexing interval (default: every hour)
   */
  private constructor(indexingInterval: string = '0 * * * *') {
    this.indexer = new CosmWasmIndexer();
    this.indexingInterval = indexingInterval;
  }
  
  /**
   * Get singleton instance of CosmWasmScheduler
   */
  public static getInstance(indexingInterval?: string): CosmWasmScheduler {
    if (!CosmWasmScheduler.instance) {
      CosmWasmScheduler.instance = new CosmWasmScheduler(indexingInterval);
    }
    return CosmWasmScheduler.instance;
  }

  /**
   * Start the scheduler
   */
  public start(): void {
    if (this.cronJob) {
      logger.warn('CosmWasm scheduler is already running');
      return;
    }

    logger.info(`Starting CosmWasm indexer scheduler with interval: ${this.indexingInterval}`);

    // Schedule regular indexing
    this.cronJob = cron.schedule(this.indexingInterval, async () => {
      try {
        logger.info('Running scheduled CosmWasm data indexing');
        await this.indexer.indexAllCosmWasmData();
        logger.info('Scheduled CosmWasm data indexing completed');
      } catch (error) {
        logger.error('Error during scheduled CosmWasm data indexing:', error);
      }
    });

    // Run an initial indexing immediately
    this.runImmediateIndexing();
  }

  /**
   * Stop the scheduler
   */
  public stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('CosmWasm indexer scheduler stopped');
    }
  }

  /**
   * Run indexing immediately (useful for initial load or manual trigger)
   */
  public async runImmediateIndexing(): Promise<void> {
    try {
      logger.info('Running immediate CosmWasm data indexing');
      await this.indexer.indexAllCosmWasmData();
      logger.info('Immediate CosmWasm data indexing completed');
    } catch (error) {
      logger.error('Error during immediate CosmWasm data indexing:', error);
    }
  }
}
