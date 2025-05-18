/**
 * MongoDB index migration for transaction collection
 * Creates optimized indexes for query performance
 */

const { MongoClient } = require('mongodb');

// Simple console logging function to replace logger
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

async function createTransactionIndexes(mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/babylon-indexer') {
  logger.info(`Using MongoDB URI: ${mongoUri}`);
  
  // Connect to MongoDB using same approach as in your existing scripts
  const client = new MongoClient(mongoUri);
  const dbName = mongoUri.split('/').pop().split('?')[0];
  
  try {
    await client.connect();
    logger.info('Connected to MongoDB for index creation');
    
    const db = client.db(dbName);
    const collection = db.collection('blockchaintransactions');
    
    logger.info('Creating transaction indexes...');
    
    // Get existing indexes
    const existingIndexes = await collection.indexes();
    logger.info(`Found ${existingIndexes.length} existing indexes`);
    
    // Helper function to check if an index with the same key pattern already exists
    const indexExists = (keyPattern) => {
      return existingIndexes.some(index => {
        // Convert both to string for easier comparison
        const existingKeys = JSON.stringify(index.key || {});
        const newKeys = JSON.stringify(keyPattern);
        return existingKeys === newKeys;
      });
    };
    
    // Compound index for efficient pagination
    // This allows for efficient range-based queries on height and time
    const paginationIndexKey = { network: 1, height: -1, time: -1 };
    if (!indexExists(paginationIndexKey)) {
      logger.info('Creating pagination index for network, height and time');
      await collection.createIndex(
        paginationIndexKey,
        { name: 'idx_pagination_range' }
      );
      logger.info('Created index: idx_pagination_range');
    } else {
      logger.info('Index for network, height and time already exists with a different name, skipping creation');
    }
    
    // Compound index for transaction type queries
    const typeIndexKey = { network: 1, type: 1, height: -1, time: -1 };
    if (!indexExists(typeIndexKey)) {
      logger.info('Creating index for transaction type queries');
      await collection.createIndex(
        typeIndexKey,
        { name: 'idx_tx_type_pagination' }
      );
      logger.info('Created index: idx_tx_type_pagination');
    } else {
      logger.info('Index for transaction type queries already exists with a different name, skipping creation');
    }
    
    // Index for timestamp-based queries
    const timeIndexKey = { network: 1, time: -1 };
    if (!indexExists(timeIndexKey)) {
      logger.info('Creating index for timestamp-based queries');
      await collection.createIndex(
        timeIndexKey,
        { name: 'idx_time_queries' }
      );
      logger.info('Created index: idx_time_queries');
    } else {
      logger.info('Index for timestamp-based queries already exists with a different name, skipping creation');
    }
    
    // Optimized index for finality signature queries (meta.typeUrl)
    const finalitySigIndexKey = { network: 1, 'meta.typeUrl': 1, isLite: 1, createdAt: 1 };
    if (!indexExists(finalitySigIndexKey)) {
      logger.info('Creating optimized index for finality signature queries...');
      await collection.createIndex(
        finalitySigIndexKey,
        { name: 'idx_finality_signatures_optimized', background: true }
      );
      logger.info('Created index: idx_finality_signatures_optimized');
    } else {
      logger.info('Optimized index for finality signature queries already exists, skipping creation');
    }
    
    logger.info('Transaction indexes created successfully');
  } catch (error) {
    logger.error(`Error creating indexes: ${error.message}`);
    throw error;
  } finally {
    await client.close();
    logger.info('MongoDB connection closed');
  }
}

// Run the migration if executed directly
if (require.main === module) {
  createTransactionIndexes()
    .then(() => {
      logger.info('Index migration completed successfully');
      process.exit(0);
    })
    .catch(error => {
      logger.error(`Index migration failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { createTransactionIndexes };
