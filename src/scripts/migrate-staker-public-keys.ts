import mongoose from 'mongoose';
import { Transaction } from '../database/models/Transaction';
import { Staker } from '../database/models/Staker';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function migrateStakerPublicKeys() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test');
    logger.info('Connected to MongoDB');

    // Get all stakers
    const stakers = await Staker.find({}, { address: 1 }).lean();
    logger.info(`${stakers.length} stakers found`);

    let updatedCount = 0;
    let skippedCount = 0;

    // For each staker
    for (const staker of stakers) {
      // Find the latest transaction of the staker
      const latestTx = await Transaction.findOne(
        { stakerAddress: staker.address },
        { stakerPublicKey: 1 }
      )
      .sort({ timestamp: -1 })
      .lean();

      if (latestTx?.stakerPublicKey) {
        // Update public key
        await Staker.updateOne(
          { address: staker.address },
          { $set: { stakerPublicKey: latestTx.stakerPublicKey } }
        );
        updatedCount++;
        
        if (updatedCount % 100 === 0) {
          logger.info(`${updatedCount} stakers updated`);
        }
      } else {
        skippedCount++;
      }
    }

    logger.info('\nMigration completed:');
    logger.info(`Updated: ${updatedCount}`);
    logger.info(`Skipped: ${skippedCount}`);

  } catch (error) {
    logger.error('Migration error:', error);
  } finally {
    await mongoose.disconnect();
    logger.info('MongoDB connection closed');
  }
}

// Run the script
migrateStakerPublicKeys(); 