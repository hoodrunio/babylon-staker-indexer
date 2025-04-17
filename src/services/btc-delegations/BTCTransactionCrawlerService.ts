import { logger } from '../../utils/logger';
import { Network } from '../../types/finality';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { BTCDelegationService } from './BTCDelegationService';
import { BabylonClient } from '../../clients/BabylonClient';
import { sleep } from '../../utils/util';
import dotenv from 'dotenv';

dotenv.config();

// Define an interface for the delegation data response
interface BtcDelegationResponse {
    btc_delegation?: {
        status_desc?: string;
        [key: string]: any;
    };
    [key: string]: any;
}

export class BTCTransactionCrawlerService {
    private static instance: BTCTransactionCrawlerService | null = null;
    private babylonClients: Map<Network, BabylonClient> = new Map();
    private delegationService: BTCDelegationService = BTCDelegationService.getInstance();
    private isCrawling: boolean = false;
    private configuredNetworks: Network[] = [];
    
    // Crawling interval: default 5 minutes (configurable through environment variable)
    private crawlingInterval: number = parseInt(process.env.BTC_TX_CRAWLING_INTERVAL || '300000', 10);
    
    // Batch size for processing transactions
    private batchSize: number = parseInt(process.env.BTC_TX_BATCH_SIZE || '50', 10);
    
    // Max retry count for API calls
    private maxRetryCount: number = parseInt(process.env.BTC_TX_MAX_RETRY_COUNT || '3', 10);

    private constructor() {
        try {
            this.initializeClients();
            
            if (this.configuredNetworks.length > 0) {
                logger.info(`Starting BTCTransactionCrawlerService for networks: ${this.configuredNetworks.join(', ')}`);
                this.startPeriodicCrawling();
            } else {
                logger.warn('No networks configured for BTCTransactionCrawlerService, service will not start');
            }
        } catch (error) {
            logger.error('Error initializing BTCTransactionCrawlerService:', error);
        }
    }

    public static getInstance(): BTCTransactionCrawlerService {
        if (!BTCTransactionCrawlerService.instance) {
            BTCTransactionCrawlerService.instance = new BTCTransactionCrawlerService();
        }
        return BTCTransactionCrawlerService.instance;
    }

    private initializeClients() {
        // Initialize Babylon clients for both networks using getInstance instead of constructor
        try {
            const mainnetClient = BabylonClient.getInstance(Network.MAINNET);
            this.babylonClients.set(Network.MAINNET, mainnetClient);
            this.configuredNetworks.push(Network.MAINNET);
            logger.info('Initialized Babylon client for MAINNET');
        } catch (error) {
            logger.warn(`Failed to initialize Babylon client for MAINNET: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        try {
            const testnetClient = BabylonClient.getInstance(Network.TESTNET);
            this.babylonClients.set(Network.TESTNET, testnetClient);
            this.configuredNetworks.push(Network.TESTNET);
            logger.info('Initialized Babylon client for TESTNET');
        } catch (error) {
            logger.warn(`Failed to initialize Babylon client for TESTNET: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async startPeriodicCrawling() {
        logger.info(`Starting periodic BTC transaction crawling every ${this.crawlingInterval / 1000} seconds for networks: ${this.configuredNetworks.join(', ')}`);
        
        // Initial crawl for configured networks
        for (const network of this.configuredNetworks) {
            try {
                logger.info(`Starting initial BTC transaction crawl for ${network}`);
                await this.crawlTransactions(network);
            } catch (error) {
                logger.error(`Error in initial BTC transaction crawling for ${network}:`, error);
            }
        }
        
        // Setup periodic crawling
        setInterval(async () => {
            for (const network of this.configuredNetworks) {
                try {
                    await this.crawlTransactions(network);
                } catch (error) {
                    logger.error(`Error in periodic BTC transaction crawling for ${network}:`, error);
                }
            }
        }, this.crawlingInterval);
    }

    private async crawlTransactions(network: Network) {
        if (this.isCrawling) {
            logger.info(`Skipping BTC transaction crawling for ${network} as another crawling is in progress`);
            return;
        }

        this.isCrawling = true;
        logger.info(`Starting BTC transaction crawling for ${network}`);

        try {
            // First, check PENDING transactions
            const pendingResults = await this.checkPendingTransactions(network);
            logger.info(`Checked PENDING transactions for ${network}: ${pendingResults.processed} processed, ${pendingResults.updated} updated`);
            
            // Then check VERIFIED transactions
            const verifiedResults = await this.checkVerifiedTransactions(network);
            logger.info(`Checked VERIFIED transactions for ${network}: ${verifiedResults.processed} processed, ${verifiedResults.updated} updated`);
            
            logger.info(`Completed BTC transaction crawling for ${network}`);
        } catch (error) {
            logger.error(`Error in BTC transaction crawling for ${network}:`, error);
        } finally {
            this.isCrawling = false;
        }
    }

    private async checkPendingTransactions(network: Network): Promise<{processed: number, updated: number}> {
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalUpdated = 0;
        
        while (hasMore) {
            try {
                // Get a batch of PENDING transactions
                const pendingDelegations = await NewBTCDelegation.find({
                    networkType: network.toLowerCase(),
                    state: 'PENDING'
                })
                .sort({ createdAt: 1 })
                .skip((page - 1) * this.batchSize)
                .limit(this.batchSize);
                
                // If no more transactions to process, exit the loop
                if (pendingDelegations.length === 0) {
                    hasMore = false;
                    break;
                }
                
                totalProcessed += pendingDelegations.length;
                logger.info(`Processing ${pendingDelegations.length} PENDING transactions for ${network}, page ${page}`);
                
                // Check each transaction status on the blockchain
                const updates = await Promise.allSettled(
                    pendingDelegations.map(async (delegation) => {
                        try {
                            // Get current status from blockchain
                            const currentStatus = await this.checkTransactionStatus(
                                delegation.stakingTxIdHex,
                                network
                            );
                            
                            // If status changed, update it
                            if (currentStatus && currentStatus !== 'PENDING') {
                                await this.delegationService.updateDelegationState(
                                    delegation.stakingTxIdHex,
                                    currentStatus,
                                    network
                                );
                                return { updated: true, txId: delegation.stakingTxIdHex, newStatus: currentStatus };
                            }
                            
                            return { updated: false, txId: delegation.stakingTxIdHex };
                        } catch (error) {
                            logger.error(`Error checking PENDING transaction ${delegation.stakingTxIdHex}:`, error);
                            return { updated: false, error, txId: delegation.stakingTxIdHex };
                        }
                    })
                );
                
                // Count updated transactions
                const updatedCount = updates.filter(
                    result => result.status === 'fulfilled' && (result.value as any).updated
                ).length;
                
                totalUpdated += updatedCount;
                
                if (updatedCount > 0) {
                    logger.info(`Updated ${updatedCount} PENDING transactions for ${network}`);
                }
                
                // Move to the next page
                page++;
                
            } catch (error) {
                logger.error(`Error processing PENDING transactions batch for ${network}:`, error);
                hasMore = false;
            }
        }
        
        return { processed: totalProcessed, updated: totalUpdated };
    }

    private async checkVerifiedTransactions(network: Network): Promise<{processed: number, updated: number}> {
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalUpdated = 0;
        
        while (hasMore) {
            try {
                // Get a batch of VERIFIED transactions
                const verifiedDelegations = await NewBTCDelegation.find({
                    networkType: network.toLowerCase(),
                    state: 'VERIFIED'
                })
                .sort({ createdAt: 1 })
                .skip((page - 1) * this.batchSize)
                .limit(this.batchSize);
                
                // If no more transactions to process, exit the loop
                if (verifiedDelegations.length === 0) {
                    hasMore = false;
                    break;
                }
                
                totalProcessed += verifiedDelegations.length;
                logger.info(`Processing ${verifiedDelegations.length} VERIFIED transactions for ${network}, page ${page}`);
                
                // Check each transaction status on the blockchain
                const updates = await Promise.allSettled(
                    verifiedDelegations.map(async (delegation) => {
                        try {
                            // Get current status from blockchain
                            const currentStatus = await this.checkTransactionStatus(
                                delegation.stakingTxIdHex,
                                network
                            );
                            
                            // If status changed, update it
                            if (currentStatus && currentStatus !== 'VERIFIED') {
                                await this.delegationService.updateDelegationState(
                                    delegation.stakingTxIdHex,
                                    currentStatus,
                                    network
                                );
                                return { updated: true, txId: delegation.stakingTxIdHex, newStatus: currentStatus };
                            }
                            
                            return { updated: false, txId: delegation.stakingTxIdHex };
                        } catch (error) {
                            logger.error(`Error checking VERIFIED transaction ${delegation.stakingTxIdHex}:`, error);
                            return { updated: false, error, txId: delegation.stakingTxIdHex };
                        }
                    })
                );
                
                // Count updated transactions
                const updatedCount = updates.filter(
                    result => result.status === 'fulfilled' && (result.value as any).updated
                ).length;
                
                totalUpdated += updatedCount;
                
                if (updatedCount > 0) {
                    logger.info(`Updated ${updatedCount} VERIFIED transactions for ${network}`);
                }
                
                // Move to the next page
                page++;
                
            } catch (error) {
                logger.error(`Error processing VERIFIED transactions batch for ${network}:`, error);
                hasMore = false;
            }
        }
        
        return { processed: totalProcessed, updated: totalUpdated };
    }

    private async checkTransactionStatus(
        stakingTxIdHex: string,
        network: Network,
        retryCount: number = 0
    ): Promise<string | null> {
        try {
            const babylonClient = this.babylonClients.get(network);
            if (!babylonClient) {
                throw new Error(`No Babylon client initialized for network ${network}`);
            }
            
            // Try to get more information from BTC delegation query endpoint
            try {
                const delegationUrl = `/babylon/btcstaking/v1/btc_delegation/${stakingTxIdHex}`;
                const delegationInfo = await fetch(`${babylonClient.getBaseUrl()}${delegationUrl}`);
                
                if (!delegationInfo.ok) {
                    logger.warn(`Failed to get BTC delegation info for ${stakingTxIdHex} on ${network}: ${delegationInfo.statusText}`);
                    return null;
                }
                
                const delegationData = await delegationInfo.json() as BtcDelegationResponse;
                if (delegationData?.btc_delegation?.status_desc) {
                    return delegationData.btc_delegation.status_desc;
                }
            } catch (delegationError) {
                logger.warn(`Error getting delegation info from API for ${stakingTxIdHex} on ${network}:`, delegationError);
                // Continue with null as we've already tried searching the txs
            }
            
            return null;
        } catch (error) {
            if (retryCount < this.maxRetryCount) {
                // Exponential backoff
                const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
                logger.info(`Retrying status check for ${stakingTxIdHex} on ${network} in ${delay}ms (retry ${retryCount + 1}/${this.maxRetryCount})`);
                
                await sleep(delay);
                return this.checkTransactionStatus(stakingTxIdHex, network, retryCount + 1);
            }
            
            logger.error(`Failed to check transaction status after ${this.maxRetryCount} retries:`, error);
            throw error;
        }
    }
} 