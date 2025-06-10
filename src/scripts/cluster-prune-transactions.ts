/**
 * Script to prune old transaction data using Node.js clustering
 * 
 * This script removes transaction data based on either:
 * 1. Age: Removes transactions older than the specified retention period in days (e.g., '30d')
 * 2. Count: Keeps only the specified number of most recent transactions (e.g., '1M' for 1 million)
 * 
 * Uses multiple CPU cores for much faster processing of large datasets.
 * 
 * Usage examples:
 * - npx ts-node src/scripts/cluster-prune-transactions.ts 30d  // Keep transactions from the last 30 days
 * - npx ts-node src/scripts/cluster-prune-transactions.ts 1M   // Keep only the most recent 1 million transactions
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cluster from 'cluster';
import os from 'os';
import { BlockchainTransaction } from '../database/models/blockchain/Transaction';
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
const BATCH_SIZE = 5000; // Number of transactions to delete in each batch

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
 * Examples: '30d' for 30 days, '1M' for 1 million transactions
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
  let deletedTransactions = 0;
  let transactionsToDelete = 0;
  let completedRanges = 0;

  // Calculate number of workers
  const numCPUs = os.cpus().length;
  const numWorkers = Math.max(1, Math.min(numCPUs - 1, 31)); // Max 8 workers, leave 1 CPU for system
  
  logger.info(`Primary ${process.pid} is running`);
  logger.info(`Starting transaction pruning with ${numWorkers} worker processes`);
  
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
      let timeThreshold: string | null = null;
      
      // Build query based on retention type
      if (retention.type === 'days') {
        // Calculate cutoff date for time-based pruning
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retention.value);
        const cutoffDateString = cutoffDate.toISOString();
        
        logger.info(`Pruning transactions older than ${cutoffDateString} for network: ${network}`);
        logger.info(`Retention period: ${retention.value} days`);
        
        query.time = { $lt: cutoffDateString };
        
        // Count transactions to be pruned
        transactionsToDelete = await BlockchainTransaction.countDocuments(query);
      } else {
        // Count-based pruning - using an optimized aggregation approach
        const totalTransactions = await BlockchainTransaction.countDocuments({ network });
        const transactionsToKeep = Math.min(retention.value, totalTransactions);
        transactionsToDelete = totalTransactions - transactionsToKeep;
        
        logger.info(`Pruning oldest ${transactionsToDelete} transactions for network: ${network}`);
        logger.info(`Keeping most recent ${transactionsToKeep} transactions`);
        
        if (transactionsToDelete > 0) {
          logger.info('Calculating threshold for count-based pruning using optimized approach...');
          
          try {
            // For very large collections, estimate using a more efficient approach
            if (totalTransactions > 10000000) { // 10M+ transactions
              logger.info('Large collection detected, using histogram-based approximation');
              
              // Get min and max time values
              const timeMinMax = await BlockchainTransaction.aggregate([
                { $match: { network } },
                { $group: {
                    _id: null,
                    minTime: { $min: '$time' },
                    maxTime: { $max: '$time' }
                  }
                }
              ]).exec();
              
              if (timeMinMax && timeMinMax.length > 0) {
                const minTime = new Date(timeMinMax[0].minTime);
                const maxTime = new Date(timeMinMax[0].maxTime);
                const totalTimespan = maxTime.getTime() - minTime.getTime();
                
                // Estimate threshold based on proportion of records to delete
                const deletionRatio = transactionsToDelete / totalTransactions;
                const estimatedTimeOffset = totalTimespan * deletionRatio;
                const estimatedThresholdTime = new Date(minTime.getTime() + estimatedTimeOffset);
                
                // Use the estimated threshold
                timeThreshold = estimatedThresholdTime.toISOString();
                query.time = { $lte: timeThreshold };
                logger.info(`Estimated time threshold for deletion: ${timeThreshold}`);
              } else {
                throw new Error('Failed to calculate time range for thresholding');
              }
            } else {
              // Use MongoDB's aggregation framework for faster threshold determination
              // Much more efficient than skip() for large collections
              logger.info('Using aggregation framework for threshold determination');
              
              // Get transaction with timestamp at the threshold position using a more memory-efficient approach
              // Instead of collecting all timestamps in memory, we'll use $skip and $limit
              const sortedAggregate = await BlockchainTransaction.aggregate([
                { $match: { network } },
                { $sort: { time: 1 } },
                { $skip: transactionsToDelete - 1 },
                { $limit: 1 },
                { $project: {
                    _id: 0,
                    thresholdTime: "$time"
                  }
                }
              ]).exec();
              
              if (sortedAggregate && sortedAggregate.length > 0 && sortedAggregate[0].thresholdTime) {
                timeThreshold = sortedAggregate[0].thresholdTime;
                query.time = { $lte: timeThreshold };
                logger.info(`Aggregation threshold for deletion: ${timeThreshold}`);
              } else {
                // If aggregation fails, fall back to regular query with hint
                logger.info('Aggregation unsuccessful, trying direct query approach');
                
                const txThreshold = await BlockchainTransaction.find({ network })
                  .sort({ time: 1 })
                  .skip(transactionsToDelete - 1)
                  .limit(1)
                  .lean()
                  .exec();
                
                if (txThreshold && txThreshold.length > 0) {
                  timeThreshold = txThreshold[0].time;
                  query.time = { $lte: timeThreshold };
                  logger.info(`Query-based threshold for deletion: ${timeThreshold}`);
                } else {
                  throw new Error('Failed to determine threshold for pruning');
                }
              }
            }
          } catch (error) {
            logger.error('Error determining threshold:', error);
            logger.info('Falling back to direct time calculation method...');
            
            // Fallback: Calculate threshold based on percentile
            const percentDelete = transactionsToDelete / totalTransactions;
            const daysToKeep = 365 * (1 - percentDelete); // Rough estimate assuming 1 year of data
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
            timeThreshold = cutoffDate.toISOString();
            
            query.time = { $lte: timeThreshold };
            logger.info(`Fallback time threshold for deletion: ${timeThreshold}`);
          }
        }
      }
      
      if (transactionsToDelete <= 0) {
        logger.info('No transactions meet the pruning criteria');
        process.exit(0);
      }
      
      logger.info(`Found ${transactionsToDelete} transactions to prune`);
      
      // Get time ranges for more efficient distribution of work
      logger.info('Calculating time ranges for worker distribution...');
      const timeRanges = await getTimeRanges(query, numWorkers);
      logger.info(`Created ${timeRanges.length} time ranges for workers`);
      
      // Fork workers
      timeRanges.forEach((range, i) => {
        const worker = cluster.fork({
          WORKER_ID: i + 1,
          NETWORK: network,
          START_TIME: range.startTime,
          END_TIME: range.endTime,
          RETENTION_TYPE: retention.type,
          TIME_THRESHOLD: timeThreshold || '',
          TOTAL_TO_DELETE: transactionsToDelete.toString()
        });
        
        logger.info(`Started worker ${i + 1} (PID: ${worker.process.pid}) for time range ${range.startTime} to ${range.endTime}`);
        
        // Listen for progress updates
        worker.on('message', (msg) => {
          if (msg.type === 'progress') {
            deletedTransactions += msg.count;
            
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const deleteRate = deletedTransactions / elapsedSeconds;
            const percentComplete = (deletedTransactions / transactionsToDelete * 100).toFixed(2);
            const estimatedTimeRemaining = ((transactionsToDelete - deletedTransactions) / deleteRate).toFixed(0);
            
            // Show progress using console.log instead of stdout.write for better compatibility
            console.log(
              `Progress: ${percentComplete}% | Deleted: ${deletedTransactions.toLocaleString()}/${transactionsToDelete.toLocaleString()} | ` +
              `Rate: ${deleteRate.toFixed(2)}/sec | Est. remaining: ${estimatedTimeRemaining}s`
            );
          }
        });
      });
      
      // Log progress periodically
      const progressInterval = setInterval(() => {
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const deleteRate = deletedTransactions / elapsedSeconds;
        const percentComplete = (deletedTransactions / transactionsToDelete * 100).toFixed(2);
        const estimatedTimeRemaining = ((transactionsToDelete - deletedTransactions) / deleteRate).toFixed(0);
        
        // Print overall progress update
        logger.info(
          `PROGRESS UPDATE: ${percentComplete}% | Deleted: ${deletedTransactions.toLocaleString()}/${transactionsToDelete.toLocaleString()} | ` +
          `Rate: ${deleteRate.toFixed(2)}/sec | Est. remaining: ${estimatedTimeRemaining}s`
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
        if (completedRanges === timeRanges.length) {
          clearInterval(progressInterval);
          
          const totalTime = (Date.now() - startTime) / 1000;
          console.log(); // Add a newline after the progress output
          logger.info(`All workers completed! Total time: ${totalTime.toFixed(2)} seconds`);
          logger.info(`Final processing rate: ${(deletedTransactions / totalTime).toFixed(2)} transactions/second`);
          logger.info(`Successfully pruned ${deletedTransactions.toLocaleString()} transactions`);
          
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
      const startTime = process.env.START_TIME || '';
      const endTime = process.env.END_TIME || '';
      const retentionType = process.env.RETENTION_TYPE || '';
      const timeThreshold = process.env.TIME_THRESHOLD || '';
      
      await connectDB();
      
      logger.info(`Worker ${workerId} (PID: ${process.pid}) processing time range ${startTime} to ${endTime}`);
      
      // Build query based on range
      const query: any = { network };
      
      if (retentionType === 'days') {
        // For day-based retention, use the worker's assigned time range
        query.time = { $gte: startTime, $lt: endTime };
      } else {
        // For count-based retention, use the time threshold but filter by the worker's range
        query.time = { $gte: startTime, $lt: endTime, $lte: timeThreshold };
      }
      
      // Count transactions in this worker's range
      const rangeCount = await BlockchainTransaction.countDocuments(query);
      logger.info(`Worker ${workerId}: Found ${rangeCount} transactions in assigned range`);
      
      let deletedCount = 0;
      let batchCount = 0;
      const startTimestamp = Date.now();
      
      // Process in batches
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Find oldest batch in this range
        const batch = await BlockchainTransaction.find(query)
          .sort({ time: 1 })
          .limit(BATCH_SIZE);
        
        if (batch.length === 0) {
          break; // No more transactions to delete
        }
        
        const batchIds = batch.map(tx => tx._id);
        
        // Delete the batch by ID for better performance
        const result = await BlockchainTransaction.deleteMany({
          _id: { $in: batchIds }
        });
        
        deletedCount += result.deletedCount;
        batchCount++;
        
        // Calculate and log progress (every 5 batches)
        if (batchCount % 5 === 0) {
          const elapsedSeconds = (Date.now() - startTimestamp) / 1000;
          const batchRate = batchCount / elapsedSeconds;
          const deleteRate = deletedCount / elapsedSeconds;
          
          logger.info(`Worker ${workerId}: Deleted ${deletedCount.toLocaleString()} transactions in ${batchCount} batches | ` +
                     `Rate: ${deleteRate.toFixed(2)}/sec, ${batchRate.toFixed(2)} batches/sec`);
        }
        
        // Always send progress to primary process
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
      
      logger.info(`Worker ${workerId}: Completed all ${deletedCount.toLocaleString()} transactions in assigned range`);
      process.exit(0);
    } catch (error) {
      logger.error(`Worker error:`, error);
      process.exit(1);
    }
  })();
}

/**
 * Get time ranges for each worker to divide up the work more evenly
 */
async function getTimeRanges(query: any, numWorkers: number): Promise<Array<{startTime: string, endTime: string}>> {
  // Find oldest and newest transaction matching the query
  const oldestTx = await BlockchainTransaction.findOne(query).sort({ time: 1 }).lean();
  const newestTx = await BlockchainTransaction.findOne(query).sort({ time: -1 }).lean();
  
  if (!oldestTx || !newestTx) {
    return []; // No transactions found
  }
  
  const oldestTime = new Date(oldestTx.time).getTime();
  const newestTime = new Date(newestTx.time).getTime();
  const timeRange = newestTime - oldestTime;
  
  // Create ranges
  const ranges = [];
  for (let i = 0; i < numWorkers; i++) {
    const startPercent = i / numWorkers;
    const endPercent = (i + 1) / numWorkers;
    
    const startTime = new Date(oldestTime + (timeRange * startPercent)).toISOString();
    const endTime = i === numWorkers - 1 
      ? new Date(newestTime + 1000).toISOString()  // Add 1 second to include the last transaction
      : new Date(oldestTime + (timeRange * endPercent)).toISOString();
    
    ranges.push({ startTime, endTime });
  }
  
  return ranges;
}
