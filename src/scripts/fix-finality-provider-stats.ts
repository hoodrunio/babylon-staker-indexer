import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { NewStaker } from '../database/models/NewStaker';
import { logger } from '../utils/logger';

dotenv.config();

const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI;
        if (!mongoURI) {
            throw new Error('MongoDB URI is not defined in environment variables');
        }

        // MongoDB connection options
        await mongoose.connect(mongoURI, {
            maxPoolSize: 50,
            socketTimeoutMS: 60000,
        });
        
        logger.info('MongoDB connected successfully');
    } catch (error) {
        logger.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

// Fix Finality Provider statistics
const fixFinalityProviderStats = async () => {
    try {
        // Connect to MongoDB
        await connectDB();

        logger.info('Starting to fix finality provider statistics...');

        // Get all stakers
        const stakerCount = await NewStaker.countDocuments({});
        logger.info(`Found ${stakerCount} stakers to process`);
        
        // Batch size for processing
        const batchSize = 500;
        let processedCount = 0;
        
        // Process stakers in batches
        for (let skip = 0; skip < stakerCount; skip += batchSize) {
            const stakers = await NewStaker.find({})
                .skip(skip)
                .limit(batchSize);
            
            // Fix statistics for each staker
            for (const staker of stakers) {
                try {
                    await fixStakerFinalityProviderStats(staker);
                    logger.info(`Fixed finality provider stats for staker: ${staker.stakerAddress}`);
                } catch (error) {
                    logger.error(`Error fixing stats for staker ${staker.stakerAddress}: ${error}`);
                }
            }
            
            processedCount += stakers.length;
            logger.info(`Processed ${processedCount}/${stakerCount} stakers`);
        }
        
        logger.info('Completed fixing finality provider statistics');
        process.exit(0);
    } catch (error) {
        logger.error('Error fixing finality provider statistics:', error);
        process.exit(1);
    }
};

// Fix finality provider statistics for a staker
const fixStakerFinalityProviderStats = async (staker: any): Promise<void> => {
    try {
        // Get delegations from the staker document
        const delegations = staker.delegations || [];
        
        if (delegations.length === 0) {
            logger.info(`No delegations found for staker: ${staker.stakerAddress}`);
            return;
        }
        
        logger.info(`Found ${delegations.length} delegations for staker: ${staker.stakerAddress}`);
        
        // Reset finality provider statistics
        // Unique finality providers
        if (staker.uniqueFinalityProviders) {
            staker.uniqueFinalityProviders.splice(0);
        } else {
            staker.uniqueFinalityProviders = [];
        }
        
        // Phase based finality providers
        if (staker.phaseStats) {
            for (const phaseStat of staker.phaseStats) {
                if (phaseStat.finalityProviders) {
                    phaseStat.finalityProviders.splice(0);
                } else {
                    phaseStat.finalityProviders = [];
                }
            }
        }
        
        // Create maps to track unique finality providers and their stats
        const uniqueFPMap = new Map();
        const phaseFPMap = new Map();
        
        // Process each delegation
        for (const delegation of delegations) {
            const { 
                finalityProviderBtcPkHex, 
                totalSat, 
                state, 
                phase 
            } = delegation;
            
            if (!finalityProviderBtcPkHex) {
                logger.warn(`Missing finalityProviderBtcPkHex for delegation in staker: ${staker.stakerAddress}`);
                continue;
            }
            
            // Update unique finality provider statistics
            // NOTE: All delegations (even UNBONDED) are counted in uniqueFinalityProviders
            if (!uniqueFPMap.has(finalityProviderBtcPkHex)) {
                uniqueFPMap.set(finalityProviderBtcPkHex, {
                    btcPkHex: finalityProviderBtcPkHex,
                    delegationsCount: 0,
                    totalStakedSat: 0
                });
            }
            
            const fpStats = uniqueFPMap.get(finalityProviderBtcPkHex);
            
            // Count non-UNBONDED delegations (to be consistent with StakerStatsService)
            if (state !== 'UNBONDED') {
                fpStats.delegationsCount += 1;
                fpStats.totalStakedSat += totalSat;
            }
            
            // Update phase-based finality provider statistics
            // NOTE: Apply the same logic for all phase-based delegations
            if (!phaseFPMap.has(phase)) {
                phaseFPMap.set(phase, new Map());
            }
            
            const phaseFPs = phaseFPMap.get(phase);
            
            if (!phaseFPs.has(finalityProviderBtcPkHex)) {
                phaseFPs.set(finalityProviderBtcPkHex, {
                    btcPkHex: finalityProviderBtcPkHex,
                    delegationsCount: 0,
                    totalStakedSat: 0
                });
            }
            
            const phaseFPStats = phaseFPs.get(finalityProviderBtcPkHex);
            
            // Count non-UNBONDED delegations
            if (state !== 'UNBONDED') {
                phaseFPStats.delegationsCount += 1;
                phaseFPStats.totalStakedSat += totalSat;
            }
        }
        
        // Update staker with fixed finality provider statistics
        // Unique finality providers
        for (const fpStats of uniqueFPMap.values()) {
            staker.uniqueFinalityProviders.push(fpStats);
        }
        
        // Phase based finality providers
        for (const [phase, fpMap] of phaseFPMap.entries()) {
            let phaseStat = staker.phaseStats ? staker.phaseStats.find((p: any) => p.phase === phase) : null;
            
            if (!phaseStat) {
                phaseStat = {
                    phase,
                    totalDelegations: 0,
                    totalStakedSat: 0,
                    activeDelegations: 0,
                    activeStakedSat: 0,
                    finalityProviders: []
                };
                
                if (!staker.phaseStats) {
                    staker.phaseStats = [];
                }
                
                staker.phaseStats.push(phaseStat);
            }
            
            for (const fpStats of fpMap.values()) {
                phaseStat.finalityProviders.push(fpStats);
            }
        }
        
        // Log the fixes
        logger.info(`Fixed finality provider stats for staker ${staker.stakerAddress}:
            Unique Finality Providers: ${staker.uniqueFinalityProviders.length}
            Phase Stats: ${staker.phaseStats ? staker.phaseStats.length : 0}
        `);
        
        // Save the fixed staker
        staker.lastUpdated = new Date();
        await staker.save();
    } catch (error) {
        logger.error(`Error fixing finality provider stats for staker: ${staker.stakerAddress}`, error);
        throw error;
    }
};

// Log memory usage
const logMemoryUsage = () => {
    const memoryUsage = process.memoryUsage();
    logger.info(`Memory usage: RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB, Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);
};

// Run the script
fixFinalityProviderStats();

// Monitor memory usage
process.on('warning', e => {
    if (e.name === 'ResourceExhaustedError') {
        logger.warn('Memory warning received:', e.message);
        if (global.gc) {
            logger.info('Forcing garbage collection');
            global.gc();
        }
    }
});

setInterval(logMemoryUsage, 30000); // Log memory usage every 30 seconds