import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { NewStakerService } from '../services/btc-delegations/NewStakerService';
import { logger } from '../utils/logger';

// Load .env file
dotenv.config();

// MongoDB connection
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI;
        if (!mongoURI) {
            throw new Error('MongoDB URI is not defined in environment variables');
        }

        // MongoDB connection options - optimized for performance
        await mongoose.connect(mongoURI, {
            maxPoolSize: 50, // Increase connection pool size
            socketTimeoutMS: 60000, // Increase socket timeout
        });
        
        logger.info('MongoDB connected successfully');
    } catch (error) {
        logger.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

// Main function
const populateNewStakers = async () => {
    try {
        // Connect to MongoDB
        await connectDB();

        logger.info('Starting to populate new stakers from existing delegations...');
        // Initialize NewStakerService
        const stakerService = NewStakerService.getInstance();

        // Log memory usage
        logMemoryUsage();


        // create new stakers from delegations
        await stakerService.createStakersFromDelegations();
        
        await new Promise(resolve => setTimeout(resolve, 10000));
        // Recalculate all staker statistics
        await stakerService.recalculateAllStakerStats();

        // Log final memory usage
        logMemoryUsage();

        logger.info('Successfully populated new stakers from existing delegations');
        process.exit(0);
    } catch (error) {
        logger.error('Error populating new stakers:', error);
        process.exit(1);
    }
};

// Run the script
populateNewStakers();

// Monitor memory usage
process.on('warning', e => {
    if (e.name === 'ResourceExhaustedError') {
        logger.warn('Memory warning received:', e.message);
        // Force garbage collection when a memory warning is received
        if (global.gc) {
            logger.info('Forcing garbage collection');
            global.gc();
        }
    }
});

// Log memory usage regularly
const logMemoryUsage = () => {
    const memoryUsage = process.memoryUsage();
    logger.info(`Memory usage: RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB, Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);
};

setInterval(logMemoryUsage, 30000); // Log memory usage every 30 seconds