import mongoose from 'mongoose';
import { config } from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
config();

/**
 * Script to create necessary indexes for blockchain transactions
 */
async function createTransactionIndexes() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/babylon-indexer';
    await mongoose.connect(mongoUri);
    logger.info('Connected to MongoDB');

    // Get the transactions collection directly to create indexes
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection is not initialized');
    }
    
    const transactionsCollection = db.collection('blockchaintransactions');

    // Get existing indexes
    const existingIndexes = await transactionsCollection.indexes();
    logger.info(`Found ${existingIndexes.length} existing indexes`);

    // Create indexes only if they don't exist
    logger.info('Checking and creating necessary indexes for blockchain transactions...');
    
    // Helper function to check if an index for a specific key pattern exists
    const indexExists = (keyPattern: Record<string, number>) => {
      const keyString = JSON.stringify(keyPattern);
      return existingIndexes.some(index => 
        JSON.stringify(index.key) === keyString
      );
    };

    // Check and create compound index for meta.content.contract and time
    if (!indexExists({ 'meta.content.contract': 1, time: -1 })) {
      logger.info('Creating index for meta.content.contract and time...');
      await transactionsCollection.createIndex(
        { 'meta.content.contract': 1, time: -1 },
        { background: true }
      );
    } else {
      logger.info('Index for meta.content.contract and time already exists');
    }
    
    // Check and create individual index for meta.content.contract
    if (!indexExists({ 'meta.content.contract': 1 })) {
      logger.info('Creating index for meta.content.contract...');
      await transactionsCollection.createIndex(
        { 'meta.content.contract': 1 },
        { background: true }
      );
    } else {
      logger.info('Index for meta.content.contract already exists');
    }
    
    // Check and create index for code_id if it exists
    if (!indexExists({ 'meta.content.code_id': 1, time: -1 })) {
      logger.info('Creating index for meta.content.code_id and time...');
      await transactionsCollection.createIndex(
        { 'meta.content.code_id': 1, time: -1 },
        { background: true }
      );
    } else {
      logger.info('Index for meta.content.code_id and time already exists');
    }

    // Check and create index for type
    if (!indexExists({ type: 1 })) {
      logger.info('Creating index for type...');
      await transactionsCollection.createIndex(
        { type: 1 },
        { background: true }
      );
    } else {
      logger.info('Index for type already exists');
    }

    logger.info('All indexes checked and created successfully');
  } catch (error) {
    logger.error('Failed to create indexes:', error);
  } finally {
    if (mongoose.connection) {
      await mongoose.connection.close();
      logger.info('Disconnected from MongoDB');
    }
  }
}

// Run the script
createTransactionIndexes();
