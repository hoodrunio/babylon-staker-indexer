import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { PhaseStats } from './models/phase-stats';
import { getPhaseConfig } from '../config/phase-config';
import { logger } from '../utils/logger';

dotenv.config();

async function setupDatabase() {
  let connection: typeof mongoose | undefined;
  try {
    // Connect to MongoDB
    connection = await mongoose.connect(process.env.MONGODB_URI!);
    logger.info('Connected to MongoDB');

    // Drop the PhaseStats collection if it exists
    try {
      const db = mongoose.connection.db;
      if (db) {
        await db.dropCollection('phasestats');
        logger.info('Dropped existing phasestats collection');
      }
    } catch (error) {
      logger.info('No existing phasestats collection to drop');
    }

    // Create indexes for other collections
    await Promise.all([
      mongoose.model('Transaction').createIndexes(),
      mongoose.model('FinalityProvider').createIndexes(),
      mongoose.model('Staker').createIndexes()
    ]);

    // Initialize phase stats
    const phaseConfig = getPhaseConfig();
    for (const phase of phaseConfig.phases) {
      const endHeight = phase.endCondition.type === 'block_height' 
        ? phase.endCondition.value 
        : phase.timeoutHeight || 0;

      await PhaseStats.create({
        phase: phase.phase,
        startHeight: phase.startHeight,
        currentHeight: phase.startHeight,
        endHeight: endHeight,
        totalStakeBTC: 0,
        totalTransactions: 0,
        uniqueStakers: 0,
        lastStakeHeight: phase.startHeight,
        lastUpdateTime: new Date(),
        status: 'active',
        completionReason: null
      });
    }

    // Drop existing indexes on PhaseStats collection
    try {
      const db = mongoose.connection.db;
      if (db) {
        const collection = db.collection('phasestats');
        await collection.dropIndexes();
        logger.info('Dropped existing indexes on phasestats collection');
      }
    } catch (error) {
      logger.info('Error dropping indexes:', error);
    }

    // Create new indexes for PhaseStats
    await mongoose.model('PhaseStats').collection.createIndex(
      { phase: 1 },
      { unique: true, name: 'idx_phase_unique' }
    );
    await mongoose.model('PhaseStats').collection.createIndex(
      { status: 1 },
      { name: 'idx_status' }
    );

    logger.info('Database indexes and phase stats initialized successfully');
  } catch (error) {
    logger.error('Error setting up database:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.disconnect();
    }
  }
}

if (require.main === module) {
  setupDatabase()
    .then(() => logger.info('Database setup completed'))
    .catch(logger.error);
}

export default setupDatabase;