/**
 * Initialize Transaction Statistics
 * This module handles initializing transaction statistics during application startup
 */

import { Network } from '../../../../types/finality';
import { TransactionStatsService } from './TransactionStatsService';
import { logger } from '../../../../utils/logger';
import { BlockProcessorModule } from '../../BlockProcessorModule';

/**
 * Initialize transaction statistics for all supported networks
 * This should be called during application startup
 */
export async function initializeTransactionStats(): Promise<void> {
  try {
    // Get supported networks from block processor module
    const blockProcessor = BlockProcessorModule.getInstance();
    const networks = blockProcessor.getSupportedNetworks();
    
    logger.info(`[TransactionStats] Initializing statistics for ${networks.length} networks`);
    
    // Initialize stats for each network
    const statsService = TransactionStatsService.getInstance();
    await statsService.initializeStats(networks as Network[]);
    
    logger.info('[TransactionStats] Statistics initialized successfully');
    
    // Start periodic updates (every hour)
    startPeriodicUpdates(networks as Network[]);
  } catch (error) {
    logger.error(`[TransactionStats] Error initializing statistics: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Start periodic updates for transaction statistics
 * @param networks Supported networks
 */
function startPeriodicUpdates(networks: Network[]): void {
  // Update stats every hour (3600000 ms)
  const UPDATE_INTERVAL = 60 * 60 * 1000;
  
  setInterval(async () => {
    logger.info('[TransactionStats] Starting periodic update of transaction statistics');
    
    const statsService = TransactionStatsService.getInstance();
    
    for (const network of networks) {
      try {
        await statsService.updateStats(network);
        logger.info(`[TransactionStats] Updated statistics for network: ${network}`);
      } catch (error) {
        logger.error(`[TransactionStats] Error updating statistics for network ${network}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, UPDATE_INTERVAL);
  
  logger.info(`[TransactionStats] Periodic updates scheduled at ${UPDATE_INTERVAL / 60 / 1000} minute intervals`);
}
