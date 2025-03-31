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
    
    const transactionsCollection = db.collection('blockchaintransactionsTree');

    // Create indexes
    logger.info('Creating indexes for blockchain transactions...');
    
    // Create compound index for meta.content.contract and time
    await transactionsCollection.createIndex(
      { 'meta.content.contract': 1, time: -1 },
      { background: true, name: 'idx_contract_time' }
    );
    
    // Create individual index for meta.content.contract
    await transactionsCollection.createIndex(
      { 'meta.content.contract': 1 },
      { background: true, name: 'idx_contract' }
    );
    
    // Create index for code_id if it exists
    await transactionsCollection.createIndex(
      { 'meta.content.code_id': 1, time: -1 },
      { background: true, name: 'idx_code_id_time' }
    );

    // Create index for type to improve performance for filtered queries
    await transactionsCollection.createIndex(
      { type: 1 },
      { background: true, name: 'idx_type' }
    );

    logger.info('All indexes created successfully');
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
