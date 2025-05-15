import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cluster from 'cluster';
import os from 'os';
import { NewStaker } from '../database/models/NewStaker';
import { NewBTCDelegation } from '../database/models/NewBTCDelegation';
import { StakerStatsService } from '../services/btc-delegations/StakerStatsService';
import { DelegationDetailsService } from '../services/btc-delegations/DelegationDetailsService';
import { StakerUtils } from '../services/btc-delegations/utils/StakerUtils';
import { RecentDelegation } from '../services/btc-delegations/interfaces/StakerInterfaces';

// Create a simple logger that works in all environments
const simpleLogger = {
    info: (message: string) => console.log(`${new Date().toISOString()} INFO: ${message}`),
    warn: (message: string) => console.warn(`${new Date().toISOString()} WARN: ${message}`),
    error: (message: string, error?: any) => {
        console.error(`${new Date().toISOString()} ERROR: ${message}`);
        if (error && error.stack) console.error(error.stack);
    },
    debug: (message: string) => console.debug(`${new Date().toISOString()} DEBUG: ${message}`)
};

// Use the simple logger directly to avoid Winston compatibility issues
const logger = simpleLogger;

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
            maxPoolSize: 20,         // Reduced connection pool size per worker
            socketTimeoutMS: 60000,  // Socket timeout
            connectTimeoutMS: 30000, // Connect timeout
        });
        
        logger.info(`[Process ${process.pid}] MongoDB connected successfully`);
    } catch (error) {
        logger.error(`[Process ${process.pid}] MongoDB connection error:`, error);
        process.exit(1);
    }
};

// Constants
const BATCH_SIZE = 200;

// Master process
if (cluster.isPrimary) {
    const startTime = Date.now();

    // Track metrics
    let completedStakers = 0;
    let totalStakerCount = 0;
    
    // Calculate number of workers
    const numCPUs = os.cpus().length;
    const numWorkers = Math.max(1, Math.min(numCPUs - 1, 8)); // Max 8 workers
    
    logger.info(`Primary ${process.pid} is running`);
    logger.info(`Starting optimized staker recalculation with ${numWorkers} worker processes`);
    
    // Initialize MongoDB to get total staker count
    (async () => {
        await connectDB();
        totalStakerCount = await NewStaker.countDocuments({});
        logger.info(`Total stakers to process: ${totalStakerCount}`);
        
        // Calculate ranges for each worker
        const stakersPerWorker = Math.ceil(totalStakerCount / numWorkers);
        
        // Fork workers
        for (let i = 0; i < numWorkers; i++) {
            const startIdx = i * stakersPerWorker;
            const endIdx = Math.min((i + 1) * stakersPerWorker, totalStakerCount);
            
            const worker = cluster.fork({
                WORKER_ID: i + 1,
                START_INDEX: startIdx,
                END_INDEX: endIdx
            });
            
            logger.info(`Started worker ${i + 1} (PID: ${worker.process.pid}) for stakers ${startIdx} to ${endIdx - 1}`);
            
            // Listen for progress updates
            worker.on('message', (msg) => {
                if (msg.type === 'progress') {
                    completedStakers += msg.count;
                    
                    const elapsedSeconds = (Date.now() - startTime) / 1000;
                    const processRate = completedStakers / elapsedSeconds;
                    const percentComplete = Math.round((completedStakers / totalStakerCount) * 100);
                    const estimatedTimeRemaining = Math.round((totalStakerCount - completedStakers) / processRate);
                    
                    logger.info(`Progress: ${completedStakers}/${totalStakerCount} stakers (${percentComplete}%) | ` + 
                                `Rate: ${processRate.toFixed(2)}/sec | ` + 
                                `Est. remaining: ${estimatedTimeRemaining} seconds`);
                }
            });
        }
        
        // Log progress periodically
        const progressInterval = setInterval(() => {
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const processRate = completedStakers / elapsedSeconds;
            const percentComplete = Math.round((completedStakers / totalStakerCount) * 100);
            const estimatedTimeRemaining = Math.round((totalStakerCount - completedStakers) / processRate);
            
            logger.info(`Overall progress: ${completedStakers}/${totalStakerCount} stakers (${percentComplete}%) | ` + 
                        `Overall rate: ${processRate.toFixed(2)}/sec | ` + 
                        `Est. remaining: ${isNaN(estimatedTimeRemaining) ? 'calculating...' : estimatedTimeRemaining + ' seconds'}`);
            
            // Log memory usage
            const memoryUsage = process.memoryUsage();
            logger.info(`Memory usage: RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB, ` + 
                        `Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);
        }, 10000); // Every 10 seconds
        
        // Listen for worker exits
        let exitedWorkers = 0;
        cluster.on('exit', (worker, code, signal) => {
            exitedWorkers++;
            logger.info(`Worker ${worker.process.pid} finished with code ${code}`);
            
            // When all workers are done
            if (exitedWorkers === numWorkers) {
                clearInterval(progressInterval);
                
                const totalTime = (Date.now() - startTime) / 1000;
                logger.info(`All workers completed! Total time: ${totalTime.toFixed(2)} seconds`);
                logger.info(`Final processing rate: ${(totalStakerCount / totalTime).toFixed(2)} stakers/second`);
                
                setTimeout(() => {
                    logger.info('Shutting down primary process');
                    process.exit(0);
                }, 1000);
            }
        });
    })();
} else {
    // Worker process
    const workerId = parseInt(process.env.WORKER_ID || '0');
    const startIndex = parseInt(process.env.START_INDEX || '0');
    const endIndex = parseInt(process.env.END_INDEX || '0');
    
    logger.info(`Worker ${workerId} (PID: ${process.pid}) started for stakers ${startIndex} to ${endIndex - 1}`);
    
    // Process batches of stakers
    (async () => {
        try {
            await connectDB();
            
            const stakerStatsService = StakerStatsService.getInstance();
            const delegationDetailsService = DelegationDetailsService.getInstance();
            let processedCount = 0;
            
            // Process stakers in batches
            for (let batchStart = startIndex; batchStart < endIndex; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, endIndex);
                logger.info(`Worker ${workerId}: Processing batch ${batchStart} to ${batchEnd - 1}`);
                
                // Get stakers for this batch
                const stakers = await NewStaker.find({}).skip(batchStart).limit(batchEnd - batchStart);
                
                // Process each staker in batch
                const stakerPromises = [];
                
                for (const staker of stakers) {
                    stakerPromises.push(processStaker(staker, stakerStatsService, delegationDetailsService));
                }
                
                // Wait for all stakers in this batch to be processed
                await Promise.all(stakerPromises);
                
                processedCount += stakers.length;
                
                // Send progress update to master
                if (cluster.isWorker) {
                    process.send?.({ 
                        type: 'progress',
                        workerId: workerId,
                        count: stakers.length
                    });
                }
                
                logger.info(`Worker ${workerId}: Completed batch ${batchStart} to ${batchEnd - 1} (${processedCount}/${endIndex - startIndex} stakers)`);
                
                // Force garbage collection if available
                if (global.gc) {
                    global.gc();
                }
            }
            
            logger.info(`Worker ${workerId}: Completed all ${endIndex - startIndex} stakers`);
            process.exit(0);
        } catch (error) {
            logger.error(`Worker ${workerId} error:`, error);
            process.exit(1);
        }
    })();
}

// Process a single staker
async function processStaker(
    staker: any, 
    stakerStatsService: StakerStatsService,
    delegationDetailsService: DelegationDetailsService
): Promise<void> {
    try {
        // Reset staker statistics
        stakerStatsService.resetStakerStats(staker);
        
        // Reset delegation details
        if (staker.delegations) {
            staker.delegations.splice(0);
        }
        
        // Get all delegations for this staker
        const delegations = await NewBTCDelegation.find({ stakerAddress: staker.stakerAddress });
        
        if (delegations.length === 0) {
            logger.info(`No delegations found for staker: ${staker.stakerAddress}`);
            await staker.save();
            return;
        }
        
        //logger.info(`Found ${delegations.length} delegations for staker: ${staker.stakerAddress}`);
        
        // Reset first and last staking times
        staker.firstStakingTime = null;
        staker.lastStakingTime = null;
        
        // Clear recent delegations
        if (staker.recentDelegations) {
            staker.recentDelegations.splice(0);
        }
        
        // Create temporary array
        const tempRecentDelegations: RecentDelegation[] = [];
        
        // Create maps to track finality provider statistics
        const uniqueFPMap = new Map();
        const phaseFPMap = new Map();
        const phaseStatsMap = new Map();
        
        // Update statistics for each delegation
        for (const delegation of delegations) {
            // Calculate phase
            const paramsVersion = delegation.paramsVersion !== null && delegation.paramsVersion !== undefined ? 
                delegation.paramsVersion : undefined;
            const phase = StakerUtils.calculatePhase(paramsVersion);
            
            // Initialize phase stats if not exists
            if (!phaseStatsMap.has(phase)) {
                phaseStatsMap.set(phase, {
                    phase,
                    totalDelegations: 0,
                    totalStakedSat: 0,
                    activeDelegations: 0,
                    activeStakedSat: 0,
                    finalityProviders: []
                });
            }
            const phaseStats = phaseStatsMap.get(phase);
            
            // Update phase stats
            phaseStats.totalDelegations += 1;
            phaseStats.totalStakedSat += delegation.totalSat;
            if (delegation.state === 'ACTIVE') {
                phaseStats.activeDelegations += 1;
                phaseStats.activeStakedSat += delegation.totalSat;
            }
            
            // Get the correct finalityProviderBtcPkHex value
            let finalityProviderBtcPkHex = '';
            if (delegation.finalityProviderBtcPksHex && delegation.finalityProviderBtcPksHex.length > 0) {
                finalityProviderBtcPkHex = delegation.finalityProviderBtcPksHex[0];
            } else {
                logger.warn(`Missing finalityProviderBtcPksHex for delegation: ${delegation.stakingTxIdHex}`);
                continue; // Skip this delegation
            }
            
            // Update first and last staking times
            if (!staker.firstStakingTime || (delegation.createdAt && new Date(delegation.createdAt).getTime() < staker.firstStakingTime)) {
                staker.firstStakingTime = delegation.createdAt ? new Date(delegation.createdAt).getTime() : delegation.stakingTime;
            }
            if (!staker.lastStakingTime || (delegation.createdAt && new Date(delegation.createdAt).getTime() > staker.lastStakingTime)) {
                staker.lastStakingTime = delegation.createdAt ? new Date(delegation.createdAt).getTime() : delegation.stakingTime;
            }
            
            // Add delegation detail
            const delegationDetail = delegationDetailsService.createDelegationDetail(delegation, phase);
            staker.delegations.push(delegationDetail);
            
            // Increase total counts
            staker.totalDelegationsCount += 1;
            staker.totalStakedSat += delegation.totalSat;
            staker.delegationStates[delegation.state] = (staker.delegationStates[delegation.state] || 0) + 1;
            
            // Update total statistics on a network basis
            if (staker.networkStats) {
                const networkStats = staker.networkStats[delegation.networkType];
                if (networkStats) {
                    networkStats.totalDelegations += 1;
                    networkStats.totalStakedSat += delegation.totalSat;
                }
            }
            
            // If the status is ACTIVE, increase the active counts
            if (delegation.state === 'ACTIVE') {
                staker.activeDelegationsCount += 1;
                staker.activeStakedSat += delegation.totalSat;
                
                // Update active statistics on a network basis
                if (staker.networkStats) {
                    const networkStats = staker.networkStats[delegation.networkType];
                    if (networkStats) {
                        networkStats.activeDelegations += 1;
                        networkStats.activeStakedSat += delegation.totalSat;
                    }
                }

                // Update finality provider maps for ACTIVE delegations
                // Unique finality providers
                if (!uniqueFPMap.has(finalityProviderBtcPkHex)) {
                    uniqueFPMap.set(finalityProviderBtcPkHex, {
                        btcPkHex: finalityProviderBtcPkHex,
                        delegationsCount: 0,
                        totalStakedSat: 0
                    });
                }
                const fpStats = uniqueFPMap.get(finalityProviderBtcPkHex);
                fpStats.delegationsCount += 1;
                fpStats.totalStakedSat += delegation.totalSat;

                // Phase based finality providers
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
                phaseFPStats.delegationsCount += 1;
                phaseFPStats.totalStakedSat += delegation.totalSat;
            }
            
            // Update recent delegations (maximum 10)
            if (tempRecentDelegations.length < 10) {
                tempRecentDelegations.push({
                    stakingTxIdHex: delegation.stakingTxIdHex,
                    txHash: StakerUtils.formatTxHash(delegation.txHash, delegation.stakingTxIdHex),
                    state: delegation.state,
                    networkType: delegation.networkType,
                    totalSat: delegation.totalSat,
                    stakingTime: delegation.stakingTime,
                    createdAt: delegation.createdAt ? new Date(delegation.createdAt) : undefined,
                    updatedAt: delegation.updatedAt ? new Date(delegation.updatedAt) : undefined
                });
            }
        }
        
        // Update staker with finality provider statistics
        staker.uniqueFinalityProviders = Array.from(uniqueFPMap.values());
        
        // Update phase stats
        staker.phaseStats = Array.from(phaseStatsMap.values());
        
        // Update phase stats with finality providers
        for (const [phase, fpMap] of phaseFPMap.entries()) {
            let phaseStat = staker.phaseStats.find((p: any) => p.phase === phase);
            if (phaseStat) {
                phaseStat.finalityProviders = Array.from(fpMap.values());
            }
        }
        
        // Log the final status
        /* logger.info(`Staker ${staker.stakerAddress} summary:
            Total Delegations: ${staker.totalDelegationsCount}
            Active Delegations: ${staker.activeDelegationsCount}
            Total Staked: ${staker.totalStakedSat}
            Active Staked: ${staker.activeStakedSat}
            Finality Providers: ${staker.uniqueFinalityProviders ? staker.uniqueFinalityProviders.length : 0}
        `); */
        
        // Sort recent delegations by stakingTime (newest to oldest)
        tempRecentDelegations.sort((a, b) => (b.stakingTime || 0) - (a.stakingTime || 0));
        
        // Add the sorted delegations to the staker
        tempRecentDelegations.forEach(d => {
            staker.recentDelegations.push(d);
        });
        
        // Set the last update time
        staker.lastUpdated = new Date();
        
        // Save the staker
        await staker.save();
    } catch (error) {
        logger.error(`Error recalculating stats for staker ${staker.stakerAddress}:`, error);
    }
}
