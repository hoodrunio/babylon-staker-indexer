/**
 * Script to prune old block data using Node.js clustering
 * 
 * This script removes block data based on either:
 * 1. Age: Removes blocks older than the specified retention period in days (e.g., '30d')
 * 2. Count: Keeps only the specified number of most recent blocks (e.g., '1M' for 1 million)
 * 
 * Uses multiple CPU cores for much faster processing of large datasets.
 * 
 * Usage examples:
 * - npx ts-node src/scripts/cluster-prune-blocks.ts 30d  // Keep blocks from the last 30 days
 * - npx ts-node src/scripts/cluster-prune-blocks.ts 1M   // Keep only the most recent 1 million blocks
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cluster from 'cluster';
import os from 'os';
import { Block } from '../database/models/blockchain/Block';
import { BabylonClient } from '../clients/BabylonClient';

// Create a simple logger that works in all environments
const logger = {
  info: (message: string) => console.log(`${new Date().toISOString()} INFO: ${message}`),
  warn: (message: string) => console.warn(`${new Date().toISOString()} WARN: ${message}`),
  error: (message: string, error?: any) => {
    console.error(`${new Date().toISOString()} ERROR: ${message}`);
    if (error && error.stack) console.error(error.stack);
  }
};

// Load environment variables
dotenv.config();

// Default retention configuration
const DEFAULT_RETENTION = '30d'; // 30 days by default
const BATCH_SIZE = 5000; // Number of blocks to delete in each batch

// MongoDB connection with optimized settings
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      throw new Error('MongoDB URI is not defined in environment variables');
    }

    // MongoDB connection options - optimized for performance
    await mongoose.connect(mongoURI, {
      maxPoolSize: 10,         // Reduced connection pool size per worker
      socketTimeoutMS: 60000,  // Socket timeout
      connectTimeoutMS: 30000, // Connect timeout
    });
    
    logger.info(`[Process ${process.pid}] MongoDB connected successfully`);
  } catch (error) {
    logger.error(`[Process ${process.pid}] MongoDB connection error:`, error);
    process.exit(1);
  }
};

/**
 * Parse retention parameter
 * Examples: '30d' for 30 days, '1M' for 1 million blocks
 */
function parseRetentionParam(param: string): { type: 'days' | 'count', value: number } {
  if (!param) {
    param = DEFAULT_RETENTION;
  }
  
  // Check if it's a day-based retention (ends with 'd' or 'D')
  if (param.endsWith('d') || param.endsWith('D')) {
    const days = parseInt(param.slice(0, -1), 10);
    if (isNaN(days) || days <= 0) {
      throw new Error('Invalid day-based retention period. Must be a positive number followed by "d" (e.g., "30d")');
    }
    return { type: 'days', value: days };
  }
  
  // Check if it's a count-based retention (ends with 'k' or 'K' for thousands)
  if (param.endsWith('k') || param.endsWith('K')) {
    const count = parseInt(param.slice(0, -1), 10) * 1000;
    if (isNaN(count) || count <= 0) {
      throw new Error('Invalid count-based retention. Must be a positive number followed by "k" (e.g., "500k")');
    }
    return { type: 'count', value: count };
  }
  
  // Check if it's a count-based retention (ends with 'M' for millions)
  if (param.endsWith('m') || param.endsWith('M')) {
    const count = parseInt(param.slice(0, -1), 10) * 1000000;
    if (isNaN(count) || count <= 0) {
      throw new Error('Invalid count-based retention. Must be a positive number followed by "M" (e.g., "1M")');
    }
    return { type: 'count', value: count };
  }
  
  // If no suffix, assume it's just a raw number for count-based retention
  const count = parseInt(param, 10);
  if (isNaN(count) || count <= 0) {
    throw new Error('Invalid retention parameter. Use format like "30d" for days or "1M" for count-based retention.');
  }
  return { type: 'count', value: count };
}

// Master process
if (cluster.isPrimary) {
  const startTime = Date.now();

  // Track metrics
  let deletedBlocks = 0;
  let blocksToDelete = 0;
  let completedRanges = 0;

  // Calculate number of workers
  const numCPUs = os.cpus().length;
  const numWorkers = Math.max(1, Math.min(numCPUs - 1, 8)); // Max 8 workers, leave 1 CPU for system
  
  logger.info(`Primary ${process.pid} is running`);
  logger.info(`Starting block pruning with ${numWorkers} worker processes`);
  
  // Initialize and determine what to delete
  (async () => {
    try {
      await connectDB();

      // Get network configuration from BabylonClient
      const babylonClient = BabylonClient.getInstance();
      const network = babylonClient.getNetwork();
      logger.info(`Using network: ${network}`);

      // Parse retention parameter
      const retention = parseRetentionParam(process.argv[2]);
      const query: any = { network };
      let heightThreshold: string | null = null;
      
      // Build query based on retention type
      if (retention.type === 'days') {
        // Calculate cutoff date for time-based pruning
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retention.value);
        const cutoffDateString = cutoffDate.toISOString();
        
        logger.info(`Pruning blocks older than ${cutoffDateString} for network: ${network}`);
        logger.info(`Retention period: ${retention.value} days`);
        
        query.time = { $lt: cutoffDateString };
        
        // Count blocks to be pruned
        blocksToDelete = await Block.countDocuments(query);
      } else {
        // Count-based pruning
        const totalBlocks = await Block.countDocuments({ network });
        const blocksToKeep = Math.min(retention.value, totalBlocks);
        blocksToDelete = totalBlocks - blocksToKeep;
        
        logger.info(`Pruning oldest ${blocksToDelete} blocks for network: ${network}`);
        logger.info(`Keeping most recent ${blocksToKeep} blocks`);
        
        if (blocksToDelete > 0) {
          // Find the height threshold for deletion
          const blockThreshold = await Block.find({ network })
            .sort({ height: 1 })
            .collation({ locale: 'en_US', numericOrdering: true })
            .skip(blocksToDelete - 1)
            .limit(1)
            .lean();
          
          if (blockThreshold && blockThreshold.length > 0) {
            heightThreshold = blockThreshold[0].height;
            query.height = { $lte: heightThreshold };
            logger.info(`Height threshold for deletion: ${heightThreshold}`);
          } else {
            logger.error('Failed to determine threshold for pruning');
            process.exit(1);
          }
        }
      }
      
      if (blocksToDelete <= 0) {
        logger.info('No blocks meet the pruning criteria');
        process.exit(0);
      }
      
      logger.info(`Found ${blocksToDelete} blocks to prune`);
      
      // Get height ranges for more efficient distribution of work
      logger.info('Calculating height ranges for worker distribution...');
      const heightRanges = await getHeightRanges(query, numWorkers);
      logger.info(`Created ${heightRanges.length} height ranges for workers`);
      
      // Fork workers
      heightRanges.forEach((range, i) => {
        const worker = cluster.fork({
          WORKER_ID: i + 1,
          NETWORK: network,
          START_HEIGHT: range.startHeight,
          END_HEIGHT: range.endHeight,
          RETENTION_TYPE: retention.type,
          HEIGHT_THRESHOLD: heightThreshold || '',
          TIME_THRESHOLD: retention.type === 'days' ? query.time.$lt : '',
          TOTAL_TO_DELETE: blocksToDelete.toString()
        });
        
        logger.info(`Started worker ${i + 1} (PID: ${worker.process.pid}) for height range ${range.startHeight} to ${range.endHeight}`);
        
        // Listen for progress updates
        worker.on('message', (msg) => {
          if (msg.type === 'progress') {
            deletedBlocks += msg.count;
            
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const deleteRate = deletedBlocks / elapsedSeconds;
            const percentComplete = (deletedBlocks / blocksToDelete * 100).toFixed(2);
            const estimatedTimeRemaining = ((blocksToDelete - deletedBlocks) / deleteRate).toFixed(0);
            
            // Show progress using console.log instead of stdout.write for better compatibility
            console.log(
              `Progress: ${percentComplete}% | Deleted: ${deletedBlocks.toLocaleString()}/${blocksToDelete.toLocaleString()} | ` +
              `Rate: ${deleteRate.toFixed(2)}/sec | Est. remaining: ${isNaN(parseFloat(estimatedTimeRemaining)) ? 'calculating...' : estimatedTimeRemaining + 's'}`
            );
          }
        });
      });
      
      // Log progress periodically
      const progressInterval = setInterval(() => {
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const deleteRate = deletedBlocks / elapsedSeconds;
        const percentComplete = (deletedBlocks / blocksToDelete * 100).toFixed(2);
        const estimatedTimeRemaining = ((blocksToDelete - deletedBlocks) / deleteRate).toFixed(0);
        
        // Print overall progress update
        logger.info(
          `PROGRESS UPDATE: ${percentComplete}% | Deleted: ${deletedBlocks.toLocaleString()}/${blocksToDelete.toLocaleString()} | ` +
          `Rate: ${deleteRate.toFixed(2)}/sec | Est. remaining: ${isNaN(parseFloat(estimatedTimeRemaining)) ? 'calculating...' : estimatedTimeRemaining + 's'}`
        );
        
        // Memory usage statistics
        const memoryUsage = process.memoryUsage();
        logger.info(`Memory usage: RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB, ` + 
                    `Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);
      }, 10000); // Every 10 seconds
      
      // Listen for worker exits
      cluster.on('exit', (worker, code) => {
        completedRanges++;
        logger.info(`Worker ${worker.process.pid} finished with code ${code}`);
        
        // When all workers are done
        if (completedRanges === heightRanges.length) {
          clearInterval(progressInterval);
          
          const totalTime = (Date.now() - startTime) / 1000;
          console.log(); // Add a newline after the progress output
          logger.info(`All workers completed! Total time: ${totalTime.toFixed(2)} seconds`);
          logger.info(`Final processing rate: ${(deletedBlocks / totalTime).toFixed(2)} blocks/second`);
          logger.info(`Successfully pruned ${deletedBlocks.toLocaleString()} blocks`);
          
          setTimeout(() => {
            logger.info('Shutting down primary process');
            process.exit(0);
          }, 1000);
        }
      });
    } catch (error) {
      logger.error('Error in primary process:', error);
      process.exit(1);
    }
  })();
} else {
  // Worker process
  (async () => {
    try {
      const workerId = parseInt(process.env.WORKER_ID || '0');
      const network = process.env.NETWORK || '';
      const startHeight = process.env.START_HEIGHT || '0';
      const endHeight = process.env.END_HEIGHT || '';
      const retentionType = process.env.RETENTION_TYPE || '';
      const heightThreshold = process.env.HEIGHT_THRESHOLD || '';
      const timeThreshold = process.env.TIME_THRESHOLD || '';
      
      await connectDB();
      
      logger.info(`Worker ${workerId} (PID: ${process.pid}) processing height range ${startHeight} to ${endHeight}`);
      
      // Build query based on range
      let query: any = { network };
      
      if (retentionType === 'days') {
        // For day-based retention, use the time threshold but filter by the worker's range
        query = {
          network,
          height: { $gte: startHeight, $lt: endHeight },
          time: { $lt: timeThreshold }
        };
      } else {
        // For count-based retention, use the height threshold
        query = {
          network,
          height: { $gte: startHeight, $lt: endHeight, $lte: heightThreshold }
        };
      }
      
      // Count blocks in this worker's range
      const rangeCount = await Block.countDocuments(query);
      logger.info(`Worker ${workerId}: Found ${rangeCount} blocks in assigned range`);
      
      let deletedCount = 0;
      let batchCount = 0;
      const startTimestamp = Date.now();
      
      // Process in batches
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Find oldest batch in this range
        const batch = await Block.find(query)
          .sort({ height: 1 })
          .collation({ locale: 'en_US', numericOrdering: true })
          .limit(BATCH_SIZE);
        
        if (batch.length === 0) {
          break; // No more blocks to delete
        }
        
        const batchIds = batch.map(block => block._id);
        
        // Delete the batch by ID for better performance
        const result = await Block.deleteMany({
          _id: { $in: batchIds }
        });
        
        deletedCount += result.deletedCount;
        batchCount++;
        
        // Calculate and log progress (every 5 batches)
        if (batchCount % 5 === 0) {
          const elapsedSeconds = (Date.now() - startTimestamp) / 1000;
          const batchRate = batchCount / elapsedSeconds;
          const deleteRate = deletedCount / elapsedSeconds;
          
          logger.info(`Worker ${workerId}: Deleted ${deletedCount.toLocaleString()} blocks in ${batchCount} batches | ` +
                     `Rate: ${deleteRate.toFixed(2)}/sec, ${batchRate.toFixed(2)} batches/sec`);
        }
        
        // Send progress to primary process
        if (cluster.isWorker && process.send) {
          process.send({
            type: 'progress',
            workerId: workerId,
            count: result.deletedCount
          });
        }
        
        // Force garbage collection if available (helps with memory usage)
        if (global.gc) {
          global.gc();
        }
      }
      
      logger.info(`Worker ${workerId}: Completed all ${deletedCount.toLocaleString()} blocks in assigned range`);
      process.exit(0);
    } catch (error) {
      logger.error(`Worker error:`, error);
      process.exit(1);
    }
  })();
}

/**
 * Get height ranges for each worker to divide up the work more evenly
 */
async function getHeightRanges(query: any, numWorkers: number): Promise<Array<{startHeight: string, endHeight: string}>> {
  try {
    // Find lowest and highest blocks matching the query
    const lowestBlock = await Block.findOne(query)
      .sort({ height: 1 })
      .collation({ locale: 'en_US', numericOrdering: true })
      .lean();
      
    const highestBlock = await Block.findOne(query)
      .sort({ height: -1 })
      .collation({ locale: 'en_US', numericOrdering: true })
      .lean();
    
    if (!lowestBlock || !highestBlock) {
      return []; // No blocks found
    }
    
    // Create numeric versions for calculation
    const lowestHeight = parseInt(lowestBlock.height);
    const highestHeight = parseInt(highestBlock.height);
    const heightRange = highestHeight - lowestHeight;
    
    if (isNaN(lowestHeight) || isNaN(highestHeight)) {
      // Fallback if we have non-numeric heights
      logger.warn('Heights are not numeric, using simple range division');
      const ranges = [];
      for (let i = 0; i < numWorkers; i++) {
        ranges.push({ 
          startHeight: i === 0 ? lowestBlock.height : `${i}`, 
          endHeight: i === numWorkers - 1 ? (parseInt(highestBlock.height) + 1).toString() : `${i+1}` 
        });
      }
      return ranges;
    }
    
    // Create ranges
    const ranges = [];
    for (let i = 0; i < numWorkers; i++) {
      const startPercent = i / numWorkers;
      const endPercent = (i + 1) / numWorkers;
      
      const startHeight = Math.floor(lowestHeight + (heightRange * startPercent)).toString();
      const endHeight = i === numWorkers - 1 
        ? (highestHeight + 1).toString()  // Add 1 to include the last block
        : Math.floor(lowestHeight + (heightRange * endPercent)).toString();
      
      ranges.push({ startHeight, endHeight });
    }
    
    return ranges;
  } catch (error) {
    logger.error('Error calculating height ranges:', error);
    // Return a simple range as fallback
    return Array.from({ length: numWorkers }, (_, i) => ({
      startHeight: i === 0 ? '0' : `${i}`,
      endHeight: `${i+1}`
    }));
  }
}
