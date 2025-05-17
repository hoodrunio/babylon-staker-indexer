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
    private babylonClient: BabylonClient;
    private delegationService: BTCDelegationService = BTCDelegationService.getInstance();
    private isCrawling: boolean = false;
    private network: Network;
    
    // Crawling interval: default 5 minutes (configurable through environment variable)
    private crawlingInterval: number = parseInt(process.env.BTC_TX_CRAWLING_INTERVAL || '300000', 10);
    
    // Batch size for processing transactions
    private batchSize: number = parseInt(process.env.BTC_TX_BATCH_SIZE || '50', 10);
    
    // Max retry count for API calls
    private maxRetryCount: number = parseInt(process.env.BTC_TX_MAX_RETRY_COUNT || '3', 10);

    private constructor() {
        try {
            // Initialize BabylonClient using the network from environment variable
            this.babylonClient = BabylonClient.getInstance();
            this.network = this.babylonClient.getNetwork();
            logger.info(`Starting BTCTransactionCrawlerService for network: ${this.network}`);
            this.startPeriodicCrawling();
        } catch (error) {
            logger.error('Error initializing BTCTransactionCrawlerService:', error);
            throw new Error('Failed to initialize BabylonClient. Please check your NETWORK environment variable.');
        }
    }

    public static getInstance(): BTCTransactionCrawlerService {
        if (!BTCTransactionCrawlerService.instance) {
            BTCTransactionCrawlerService.instance = new BTCTransactionCrawlerService();
        }
        return BTCTransactionCrawlerService.instance;
    }

    // No longer need to initialize multiple clients

    private async startPeriodicCrawling() {
        logger.info(`Starting periodic BTC transaction crawling every ${this.crawlingInterval / 1000} seconds for network: ${this.network}`);
        
        // Initial crawl for the configured network
        try {
            logger.info(`Starting initial BTC transaction crawl for ${this.network}`);
            await this.crawlTransactions(this.network);
        } catch (error) {
            logger.error(`Error in initial BTC transaction crawling for ${this.network}:`, error);
        }
        
        // Setup periodic crawling
        setInterval(async () => {
            try {
                await this.crawlTransactions(this.network);
            } catch (error) {
                logger.error(`Error in periodic BTC transaction crawling for ${this.network}:`, error);
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
            // No need to check if babylonClient exists since it's initialized in the constructor
            // and constructor will throw if initialization fails
            
            // Try to get more information from BTC delegation query endpoint
            try {
                const delegationUrl = `/babylon/btcstaking/v1/btc_delegation/${stakingTxIdHex}`;
                const delegationInfo = await fetch(`${this.babylonClient.getBaseUrl()}${delegationUrl}`);
                
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