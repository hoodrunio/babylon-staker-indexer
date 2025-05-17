/**
 * Script to generate transaction statistics for all networks
 * This script should be run before deploying the application to ensure
 * statistics are pre-computed for all existing transactions.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { logger } = require('../../dist/utils/logger');

// Wait for MongoDB connection
async function connectToMongoDB() {
  try {
    const mongoUri = process.env.MONGODB_URI || 
        `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT}/${process.env.MONGODB_DBNAME}?authSource=${process.env.MONGODB_AUTH_SOURCE || 'admin'}`;
    
    logger.info(`Connecting to MongoDB at ${mongoUri.replace(/\/\/.*?@/, '//***:***@')}`);
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    logger.info('Connected to MongoDB successfully');
  } catch (error) {
    logger.error(`Failed to connect to MongoDB: ${error.message}`);
    process.exit(1);
  }
}

// Define Transaction Schema (simplified version)
const TransactionSchema = new mongoose.Schema({
  txHash: { type: String, required: true },
  network: { type: String, required: true },
  type: String,
  height: String,
  time: Date
});
const BlockchainTransaction = mongoose.model('BlockchainTransaction', TransactionSchema);

// Define Block Schema (simplified version)
const BlockSchema = new mongoose.Schema({
  network: { type: String, required: true },
  blockHash: { type: String, required: true },
  height: String,
  numTxs: Number,
  time: Date
});
const Block = mongoose.model('Block', BlockSchema);

// Define Transaction Stats Schema
const TransactionStatsSchema = new mongoose.Schema({
  network: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  totalCount: {
    type: Number,
    required: true,
    default: 0
  },
  latestHeight: {
    type: Number,
    required: true,
    default: 0
  },
  countByType: {
    type: Map,
    of: Number,
    default: {}
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  last24HourCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});
const TransactionStats = mongoose.model('TransactionStats', TransactionStatsSchema);

// Generate stats for a network
async function generateStatsForNetwork(network) {
  const startTime = Date.now();
  logger.info(`Generating statistics for network: ${network}`);
  
  try {
    // Get total transaction count
    const totalCount = await BlockchainTransaction.countDocuments({ network });
    
    // Get latest transaction height using string comparison and numeric sorting
    // Babylon heights are stored as strings but need to be compared numerically
    // First convert height strings to numbers for proper sorting
    
    // First approach - direct sort
    logger.info(`Finding latest height for network ${network} using direct sort`);
    const latestTx = await BlockchainTransaction.findOne({ network })
      .sort({ height: -1 })
      .collation({ locale: 'en_US', numericOrdering: true })
      .limit(1)
      .lean();
    
    // Alternative approach - aggregate with numeric conversion
    // This is more reliable when heights are stored as strings
    logger.info(`Verifying with aggregate approach (convert string heights to numbers)`);
    const heightAggResult = await BlockchainTransaction.aggregate([
      { $match: { network } },
      { $addFields: { numericHeight: { $convert: { input: "$height", to: "int" } } } },
      { $sort: { numericHeight: -1 } },
      { $limit: 1 }
    ]);
    
    // Compare results
    const directHeight = latestTx?.height;
    const aggregateHeight = heightAggResult.length > 0 ? heightAggResult[0].height : null;
    
    logger.info(`Height comparison - Direct query: ${directHeight}, Aggregate: ${aggregateHeight}`);
    
    // Use the aggregate result if it found a higher height
    const finalLatestTx = aggregateHeight && (!directHeight || parseInt(aggregateHeight) > parseInt(directHeight))
      ? heightAggResult[0]
      : latestTx;
      
    // Parse the final height value
    let latestHeight = 0;
    if (finalLatestTx?.height) {
      // Remove any non-numeric characters if present
      const heightStr = String(finalLatestTx.height).replace(/[^0-9]/g, '');
      latestHeight = heightStr ? parseInt(heightStr, 10) : 0;
      logger.info(`Final transaction used: ${JSON.stringify(finalLatestTx.txHash || 'Unknown')}`);
      logger.info(`Raw latest height from DB: ${finalLatestTx.height}, Parsed height: ${latestHeight}`);
    }
    
    // Get transaction counts by type
    const typeCounts = await BlockchainTransaction.aggregate([
      { $match: { network } },
      { $group: { _id: "$type", count: { $sum: 1 } } }
    ]);
    
    // Format type counts as a record
    const countByType = {};
    typeCounts.forEach(item => {
      if (item._id) {
        // Sanitize transaction type key by replacing dots with underscores
        // This is needed because Mongoose maps don't support keys with dots
        const sanitizedKey = item._id.replace(/\./g, '_');
        countByType[sanitizedKey] = item.count;
        
        // If the key was sanitized, log it for debugging
        if (sanitizedKey !== item._id) {
          logger.debug(`Sanitized transaction type key: ${item._id} -> ${sanitizedKey}`);
        }
      }
    });
    
    // Get transaction count for last 24 hours using blocks collection
    // This is more accurate than estimating from block height
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    logger.info(`Calculating transactions in the last 24 hours (since ${oneDayAgo.toISOString()})`);
    
    // Find blocks from the last 24 hours
    const blocksLast24Hours = await Block.find({
      network,
      time: { $gte: oneDayAgo }
    }).lean();
    
    // Calculate total transactions using numTxs field
    let last24HourCount = 0;
    
    if (blocksLast24Hours.length > 0) {
      // Sum up numTxs from all blocks in the last 24 hours
      last24HourCount = blocksLast24Hours.reduce((total, block) => {
        return total + (block.numTxs || 0);
      }, 0);
      
      const minHeight = Math.min(...blocksLast24Hours.map(b => parseInt(b.height || '0')));
      const maxHeight = Math.max(...blocksLast24Hours.map(b => parseInt(b.height || '0')));
      
      logger.info(`Found ${blocksLast24Hours.length} blocks in last 24 hours from height ${minHeight} to ${maxHeight} with ${last24HourCount} total transactions`);
    } else {
      logger.info('No blocks found in the last 24 hours. Using fallback method.');
      
      // Fallback: Use last 10,000 blocks as requested by user
      const latestHeightNum = parseInt(latestHeight, 10);
      const blockRangeStart = Math.max(1, latestHeightNum - 10000);
      
      // Get a count of transactions in the last 10,000 blocks
      const fallbackBlocks = await Block.find({
        network,
        height: { $gte: blockRangeStart.toString() }
      }).lean();
      
      if (fallbackBlocks.length > 0) {
        last24HourCount = fallbackBlocks.reduce((total, block) => {
          return total + (block.numTxs || 0);
        }, 0);
        
        logger.info(`Fallback: Found ${fallbackBlocks.length} blocks from height ${blockRangeStart} to ${latestHeight} with ${last24HourCount} total transactions`);
      } else {
        logger.warn(`No blocks found in the last 10,000 range. Setting 24-hour count to 0.`);
      }
    }
    
    // Create or update stats document
    await TransactionStats.updateOne(
      { network },
      {
        $set: {
          totalCount,
          latestHeight,
          countByType,
          last24HourCount,
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );
    
    const duration = Date.now() - startTime;
    logger.info(`Statistics for network ${network} generated in ${duration}ms: ${totalCount} transactions, latest height ${latestHeight}`);
    
    return { network, totalCount, latestHeight, duration };
  } catch (error) {
    logger.error(`Error generating statistics for network ${network}: ${error.message}`);
    throw error;
  }
}

// Main function
async function main() {
  try {
    await connectToMongoDB();
    
    // Get all distinct networks from transactions collection
    const networks = await BlockchainTransaction.distinct('network');
    
    if (!networks || networks.length === 0) {
      logger.warn('No networks found in the database');
      process.exit(0);
    }
    
    logger.info(`Found ${networks.length} networks: ${networks.join(', ')}`);
    
    // Generate stats for each network
    const results = [];
    for (const network of networks) {
      const result = await generateStatsForNetwork(network);
      results.push(result);
    }
    
    // Print summary
    logger.info('----- Statistics Generation Summary -----');
    results.forEach(result => {
      logger.info(`Network: ${result.network}, Total: ${result.totalCount}, Latest Height: ${result.latestHeight}, Duration: ${result.duration}ms`);
    });
    
    logger.info('Transaction statistics generation completed successfully');
  } catch (error) {
    logger.error(`Failed to generate transaction statistics: ${error.message}`);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    process.exit(0);
  }
}

// Run the main function
main();
