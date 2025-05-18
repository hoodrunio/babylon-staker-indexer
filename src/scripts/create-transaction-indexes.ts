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
    
    // List all collections first to confirm names
    const collections = await db.listCollections().toArray();
    logger.info('Collections in database:');
    collections.forEach(col => {
      logger.info(`- ${col.name}`);
    });
    
    // Try with both possible names
    let transactionsCollection;
    const possibleNames = ['blockchaintransactions', 'blockchaintransactionsTree', 'BlockchainTransaction', 'blockchaintransaction'];
    
    for (const name of possibleNames) {
      try {
        const collection = db.collection(name);
        const count = await collection.countDocuments();
        logger.info(`Collection '${name}' exists with ${count} documents`);
        
        // Get existing indexes
        const indexes = await collection.indexes();
        logger.info(`Indexes for '${name}' collection:`);
        indexes.forEach(idx => {
          logger.info(`- ${JSON.stringify(idx.name)}: ${JSON.stringify(idx.key)}`);
        });
        
        // If we get here, collection exists
        transactionsCollection = collection;
        logger.info(`Using collection: ${name}`);
        break;
      } catch (err) {
        logger.info(`Collection '${name}' access failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    
    if (!transactionsCollection) {
      throw new Error('Could not find blockchain transactions collection');
    }

    // Create indexes only if they don't exist
    logger.info('Checking and creating necessary indexes for blockchain transactions...');
    
    // Helper function to check if an index for a specific key pattern exists
    const indexExists = (keyPattern: Record<string, number>) => {
      const keyString = JSON.stringify(keyPattern);
      return existingIndexes.some(index => 
        JSON.stringify(index.key) === keyString
      );
    };
    
    // Get existing indexes
    const existingIndexes = await transactionsCollection.indexes();
    logger.info(`Found ${existingIndexes.length} existing indexes`);

    // Check and create compound index for meta.content.contract and time
    if (!indexExists({ 'meta.content.contract': 1, time: -1 })) {
      logger.info('Creating index for meta.content.contract and time...');
      await transactionsCollection.createIndex(
        { 'meta.content.contract': 1, time: -1 },
        { background: true, name: 'idx_contract_time' }
      );
    } else {
      logger.info('Index for meta.content.contract and time already exists');
    }
    
    // Check and create individual index for meta.content.contract
    if (!indexExists({ 'meta.content.contract': 1 })) {
      logger.info('Creating index for meta.content.contract...');
      await transactionsCollection.createIndex(
        { 'meta.content.contract': 1 },
        { background: true, name: 'idx_contract' }
      );
    } else {
      logger.info('Index for meta.content.contract already exists');
    }
    
    // Check and create optimized index for finality signature queries (meta.typeUrl)
    if (!indexExists({ network: 1, 'meta.typeUrl': 1, isLite: 1, createdAt: 1 })) {
      logger.info('Creating optimized index for finality signature queries...');
      await transactionsCollection.createIndex(
        { network: 1, 'meta.typeUrl': 1, isLite: 1, createdAt: 1 },
        { background: true, name: 'idx_finality_signatures_optimized' }
      );
      logger.info('Successfully created optimized index for finality signature queries');
    } else {
      logger.info('Optimized index for finality signature queries already exists');
    }
    
    // Check and create index for code_id if it exists
    if (!indexExists({ 'meta.content.code_id': 1, time: -1 })) {
      logger.info('Creating index for meta.content.code_id and time...');
      await transactionsCollection.createIndex(
        { 'meta.content.code_id': 1, time: -1 },
        { background: true, name: 'idx_code_id_time' }
      );
    } else {
      logger.info('Index for meta.content.code_id and time already exists');
    }

    // Check and create index for type
    if (!indexExists({ type: 1 })) {
      logger.info('Creating index for type...');
      await transactionsCollection.createIndex(
        { type: 1 },
        { background: true, name: 'idx_type' }
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
