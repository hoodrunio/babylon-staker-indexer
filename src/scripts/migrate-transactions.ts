/**
 * Migration script to add firstMessageType field to existing transactions
 * 
 * Usage:
 * npm run migrate-transactions
 * 
 * or
 * 
 * ts-node src/scripts/migrate-transactions.ts
 */

import { TxStorage } from '../services/block-processor/storage/TxStorage';
import { Network } from '../types/finality';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/babylon-staker-indexer';
        await mongoose.connect(mongoUri);
        logger.info('Connected to MongoDB');
        
        // Get TxStorage instance
        const txStorage = TxStorage.getInstance();
        
        // Migrate transactions for MAINNET
        logger.info('Starting migration for MAINNET');
        await txStorage.migrateExistingTransactions(Network.MAINNET);
        
        // Migrate transactions for TESTNET
        logger.info('Starting migration for TESTNET');
        await txStorage.migrateExistingTransactions(Network.TESTNET);
        
        logger.info('Migration completed successfully');
        
        // Disconnect from MongoDB
        await mongoose.disconnect();
        logger.info('Disconnected from MongoDB');
        
        process.exit(0);
    } catch (error) {
        logger.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

// Run the migration
main(); 