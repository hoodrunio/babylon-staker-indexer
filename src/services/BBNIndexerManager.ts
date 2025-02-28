import { Network } from '../types/finality';
import { BBNTransactionIndexer } from './bbn/BBNTransactionIndexer';
import { BBNStakeIndexer } from './bbn/BBNStakeIndexer';
import { BBNStatsScheduler } from './scheduler/BBNStatsScheduler';
import { logger } from '../utils/logger';
import { BabylonClient } from '../clients/BabylonClient';

/**
 * Manager for BBN indexing services
 */
export class BBNIndexerManager {
    private static instance: BBNIndexerManager;
    private transactionIndexers: Map<Network, BBNTransactionIndexer> = new Map();
    private stakeIndexers: Map<Network, BBNStakeIndexer> = new Map();
    private statsScheduler: BBNStatsScheduler;
    private isRunning: boolean = false;
    
    /**
     * Private constructor to enforce singleton pattern
     */
    private constructor() {
        this.statsScheduler = BBNStatsScheduler.getInstance();
    }
    
    /**
     * Get singleton instance
     */
    public static getInstance(): BBNIndexerManager {
        if (!BBNIndexerManager.instance) {
            BBNIndexerManager.instance = new BBNIndexerManager();
        }
        return BBNIndexerManager.instance;
    }
    
    /**
     * Initialize and start all BBN indexers
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('BBNIndexerManager is already running');
            return;
        }
        
        try {
            logger.info('Starting BBNIndexerManager...');
            
            // Check which networks are configured
            const networks: Network[] = [];
            for (const network of [Network.MAINNET, Network.TESTNET]) {
                try {
                    // Check if network is configured
                    BabylonClient.getInstance(network);
                    networks.push(network);
                    logger.info(`Network ${network} is configured and will be indexed`);
                } catch (error: any) {
                    logger.warn(`Network ${network} is not configured, skipping indexing: ${error.message}`);
                }
            }
            
            if (networks.length === 0) {
                throw new Error('No networks are configured. Please check your environment variables.');
            }
            
            // Start transaction indexers for configured networks
            for (const network of networks) {
                logger.info(`Starting BBNTransactionIndexer for ${network}`);
                const txIndexer = BBNTransactionIndexer.getInstance(network);
                await txIndexer.start();
                this.transactionIndexers.set(network, txIndexer);
                
                logger.info(`Starting BBNStakeIndexer for ${network}`);
                const stakeIndexer = BBNStakeIndexer.getInstance(network);
                await stakeIndexer.start();
                this.stakeIndexers.set(network, stakeIndexer);
            }
            
            // Start stats scheduler
            logger.info('Starting BBN stats scheduler');
            this.statsScheduler.start();
            
            // Run initial stats calculation
            await this.calculateInitialStats();
            
            this.isRunning = true;
            logger.info('BBNIndexerManager started successfully');
        } catch (error) {
            logger.error('Error starting BBNIndexerManager:', error);
            await this.stop();
            throw error;
        }
    }
    
    /**
     * Stop all BBN indexers
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            logger.warn('BBNIndexerManager is not running');
            return;
        }
        
        logger.info('Stopping BBNIndexerManager...');
        
        // Stop transaction indexers
        for (const [network, txIndexer] of this.transactionIndexers.entries()) {
            logger.info(`Stopping BBNTransactionIndexer for ${network}`);
            txIndexer.stop();
        }
        this.transactionIndexers.clear();
        
        // Stop stake indexers
        for (const [network, stakeIndexer] of this.stakeIndexers.entries()) {
            logger.info(`Stopping BBNStakeIndexer for ${network}`);
            stakeIndexer.stop();
        }
        this.stakeIndexers.clear();
        
        // Stop stats scheduler
        logger.info('Stopping BBN stats scheduler');
        this.statsScheduler.stop();
        
        this.isRunning = false;
        logger.info('BBNIndexerManager stopped successfully');
    }
    
    /**
     * Calculate initial statistics for all periods and networks
     */
    private async calculateInitialStats(): Promise<void> {
        try {
            logger.info('Calculating initial BBN stats');
            await this.statsScheduler.runOnDemand();
            logger.info('Initial BBN stats calculation completed');
        } catch (error) {
            logger.error('Error calculating initial BBN stats:', error);
        }
    }
} 