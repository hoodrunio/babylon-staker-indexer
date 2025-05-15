/**
 * Database Optimization Script
 * Creates optimized indexes for MongoDB collections to improve query performance
 */

const { createTransactionIndexes } = require('../database/migrations/create-transaction-indexes');
const { config } = require('dotenv');

// Load environment variables
config();

async function main() {
  console.log('Starting database optimization...');
  
  // Get MongoDB URI from environment variable or command line
  const mongoUri = process.env.MONGODB_URI || process.argv[2] || 'mongodb://localhost:27017/babylon-indexer';
  
  try {
    // Create transaction indexes
    console.log('Creating transaction indexes...');
    await createTransactionIndexes(mongoUri);
    
    console.log('Database optimization completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error during database optimization:', error);
    process.exit(1);
  }
}

// Display usage information if --help flag is provided
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: node scripts/optimize-db.js [mongodb-uri]

Options:
  mongodb-uri    Full MongoDB connection URI with database name
                 (default: mongodb://localhost:27017/babylon-indexer)
                 Example: mongodb://username:password@host:port/dbname

You can also set environment variables:
  MONGODB_URI    - MongoDB connection URI including credentials if needed

This script will create optimized indexes for transaction queries to
enhance the performance of the 'latest-transactions' endpoint.
`);
  process.exit(0);
}

// Run the optimization script
main();
