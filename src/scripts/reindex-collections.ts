/**
 * MongoDB Collection Reindexing Script
 * This script will reindex MongoDB collections for block heights numerically
 */

import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import { Block } from '../database/models/blockchain/Block';
import { BlockchainTransaction } from '../database/models/blockchain/Transaction';

dotenv.config();

async function reindexCollections() {
  try {
    logger.info('Reindexing MongoDB collections...');
    
    // MongoDB connection
    const MONGODB_URI = process.env.MONGODB_URI || '';
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    
    await mongoose.connect(MONGODB_URI);
    logger.info('Connected to MongoDB');

    // Create new indexes for models and apply them to the DB
    // This is a safer method that works with mongoose schemas
    logger.info('Creating new indexes for Block and Transaction models');
    
    // Reindex Block model
    // First remove existing indexes
    try {
      // @ts-ignore
      Block.schema.indexes().forEach(indexSpec => {
        const indexKeys = indexSpec[0];
        // Check for indexes containing height and network
        if (indexKeys.height !== undefined && indexKeys.network !== undefined) {
          // @ts-ignore
          Block.schema.index(indexKeys, {
            ...indexSpec[1], // preserve existing properties
            collation: { locale: 'en_US', numericOrdering: true } // add collation
          });
          logger.info('Block model height/network index updated with collation');
        }
      });
    } catch (error) {
      logger.warn(`Error updating Block index: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Reindex Transaction model
    try {
      // @ts-ignore
      BlockchainTransaction.schema.indexes().forEach(indexSpec => {
        const indexKeys = indexSpec[0];
        // Check for indexes containing height and network
        if (indexKeys.height !== undefined && indexKeys.network !== undefined) {
          // @ts-ignore
          BlockchainTransaction.schema.index(indexKeys, {
            ...indexSpec[1],
            collation: { locale: 'en_US', numericOrdering: true }
          });
          logger.info('Transaction model height/network index updated with collation');
        }
        
        // Also check for aggregation index
        if (indexKeys.network !== undefined && indexKeys.height !== undefined && indexKeys.time !== undefined) {
          // @ts-ignore
          BlockchainTransaction.schema.index(indexKeys, {
            ...indexSpec[1], 
            collation: { locale: 'en_US', numericOrdering: true }
          });
          logger.info('Transaction model aggregation index updated with collation');
        }
      });
    } catch (error) {
      logger.warn(`Error updating Transaction index: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Apply all indexes to the DB
    await Promise.all([
      // @ts-ignore
      Block.ensureIndexes(),
      // @ts-ignore
      BlockchainTransaction.ensureIndexes()
    ]);
    
    logger.info('All indexes applied to the DB');

    logger.info('All collections reindexed successfully');
    
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
    
    process.exit(0);
  } catch (error) {
    logger.error(`Error reindexing collections: ${error instanceof Error ? error.message : String(error)}`);
    
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // Ignore errors when disconnecting
    }
    
    process.exit(1);
  }
}

// Run the script
reindexCollections();
