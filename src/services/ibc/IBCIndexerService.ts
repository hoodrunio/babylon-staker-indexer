import { logger } from '../../utils/logger';
import { BabylonClient } from '../../clients/BabylonClient';
import { Network } from '../../types/finality';
import { IBCEventProcessor } from './IBCEventProcessor';
import { IndexerState } from '../../database/models/IndexerState';

/**
 * Main service for indexing IBC data.
 * Responsible for scanning blocks, finding IBC-related transactions,
 * and delegating event processing to the IBCEventProcessor.
 */
export class IBCIndexerService {
  private static instance: IBCIndexerService;
  private babylonClient: BabylonClient;
  private eventProcessor: IBCEventProcessor;
  private running: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly SERVICE_NAME = 'ibc-indexer';
  
  private constructor() {
    this.babylonClient = BabylonClient.getInstance();
    this.eventProcessor = new IBCEventProcessor();
    logger.info('IBCIndexerService initialized');
  }
  
  public static getInstance(): IBCIndexerService {
    if (!IBCIndexerService.instance) {
      IBCIndexerService.instance = new IBCIndexerService();
    }
    return IBCIndexerService.instance;
  }
  
  public async start(): Promise<void> {
    if (this.running) {
      logger.info('IBCIndexerService already running');
      return;
    }
    
    this.running = true;
    logger.info('Starting IBC indexer service');
    
    // Start with historical indexing if needed
    await this.indexHistoricalData();
    
    // Then switch to polling mode for new blocks
    const pollIntervalMs = parseInt(process.env.IBC_POLL_INTERVAL_MS || '5000');
    this.pollInterval = setInterval(() => this.pollNewBlocks(), pollIntervalMs);
    
    logger.info('IBC indexer service started successfully');
  }
  
  public stop(): void {
    if (!this.running) return;
    
    logger.info('Stopping IBC indexer service');
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    this.running = false;
    logger.info('IBC indexer service stopped');
  }
  
  /**
   * Indexes historical data based on environment configuration
   */
  private async indexHistoricalData(): Promise<void> {
    try {
      const network = process.env.NETWORK === 'mainnet' ? Network.MAINNET : Network.TESTNET;
      
      // Get the last processed height from database
      const lastProcessedHeight = await this.getLastProcessedHeight(network);
      
      // If IBC_HISTORICAL_SYNC is enabled, process blocks from the configured height
      if (process.env.IBC_HISTORICAL_SYNC === 'true') {
        const fromHeight = parseInt(process.env.IBC_SYNC_FROM_HEIGHT || '0');
        const toHeight = parseInt(process.env.IBC_SYNC_TO_HEIGHT || '0');
        
        if (fromHeight > 0) {
          const startHeight = Math.max(fromHeight, lastProcessedHeight + 1);
          const endHeight = toHeight > 0 ? toHeight : await this.getCurrentHeight(network);
          
          if (startHeight <= endHeight) {
            logger.info(`Starting IBC historical sync from height ${startHeight} to ${endHeight}`);
            await this.processBlockRange(startHeight, endHeight, network);
          }
        }
      }
    } catch (error) {
      logger.error(`Error indexing historical data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Polls for new blocks and processes IBC events in them
   */
  private async pollNewBlocks(): Promise<void> {
    try {
      const network = process.env.NETWORK === 'mainnet' ? Network.MAINNET : Network.TESTNET;
      
      // Get latest processed height from database
      const lastProcessedHeight = await this.getLastProcessedHeight(network);
      
      // Get current blockchain height
      const currentHeight = await this.getCurrentHeight(network);
      
      // Process new blocks
      if (currentHeight > lastProcessedHeight) {
        logger.info(`Processing IBC data for blocks ${lastProcessedHeight + 1} to ${currentHeight}`);
        
        await this.processBlockRange(lastProcessedHeight + 1, currentHeight, network);
      }
    } catch (error) {
      logger.error(`Error polling for new blocks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Process a range of blocks
   */
  private async processBlockRange(fromHeight: number, toHeight: number, network: Network): Promise<void> {
    for (let height = fromHeight; height <= toHeight; height++) {
      try {
        await this.processBlockAtHeight(height, network);
        
        // Update last processed height after each block
        await this.updateLastProcessedHeight(height, network);
        
        // Log progress for every 100 blocks
        if (height % 100 === 0 || height === toHeight) {
          logger.info(`IBC indexer processed block ${height}/${toHeight}`);
        }
      } catch (error) {
        logger.error(`Error processing block at height ${height}: ${error instanceof Error ? error.message : String(error)}`);
        // Continue with next block despite error
      }
    }
  }
  
  /**
   * Process a single block at specified height
   */
  private async processBlockAtHeight(height: number, network: Network): Promise<void> {
    // Get block data
    const blockResponse = await this.babylonClient.getBlockByHeight(height, network);
    
    // Process each transaction in the block
    for (const txHash of blockResponse.block.data.txs || []) {
      try {
        // Get transaction details including events
        const txResponse = await this.babylonClient.getTransaction(txHash, network);
        
        // Skip if transaction response is missing or has no events
        if (!txResponse || !txResponse.tx_result || !txResponse.tx_result.events) {
          continue;
        }
        
        // Process IBC events in this transaction
        await this.eventProcessor.processEvents(
          txResponse.tx_result.events,
          {
            height,
            txHash,
            timestamp: new Date(blockResponse.block.header.time),
            network: network === Network.MAINNET ? 'mainnet' : 'testnet'
          }
        );
      } catch (error) {
        logger.error(`Error processing tx ${txHash} in block ${height}: ${error instanceof Error ? error.message : String(error)}`);
        // Continue with next transaction despite error
      }
    }
  }
  
  /**
   * Get the current blockchain height
   */
  private async getCurrentHeight(network: Network): Promise<number> {
    const latestBlockResponse = await this.babylonClient.getLatestBlock(network);
    return parseInt(latestBlockResponse.block.header.height);
  }
  
  /**
   * Get the last processed height from database
   */
  private async getLastProcessedHeight(network: Network): Promise<number> {
    const networkStr = network === Network.MAINNET ? 'mainnet' : 'testnet';
    const indexerState = await IndexerState.findOne({ 
      service: this.SERVICE_NAME,
      network: networkStr
    });
    
    return indexerState ? indexerState.lastProcessedHeight : 0;
  }
  
  /**
   * Update the last processed height in database
   */
  private async updateLastProcessedHeight(height: number, network: Network): Promise<void> {
    const networkStr = network === Network.MAINNET ? 'mainnet' : 'testnet';
    
    await IndexerState.findOneAndUpdate(
      { service: this.SERVICE_NAME, network: networkStr },
      { 
        service: this.SERVICE_NAME,
        network: networkStr,
        lastProcessedHeight: height,
        lastUpdated: new Date()
      },
      { upsert: true }
    );
  }
}
