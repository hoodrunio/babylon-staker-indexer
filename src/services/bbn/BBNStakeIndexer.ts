import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { BBNStake } from '../../database/models/bbn/BBNStake';
import { BBNAccount } from '../../database/models';
import { 
    BBNStakeStatus,
    BBNStakeData 
} from '../../types/bbn';
import { logger } from '../../utils/logger';
import { CacheService } from '../CacheService';
import { WebsocketService } from '../WebsocketService';

/**
 * Service for indexing BBN stake transactions
 */
export class BBNStakeIndexer {
    private static instances: Map<Network, BBNStakeIndexer> = new Map();
    private isRunning: boolean = false;
    private babylonClient: BabylonClient;
    private network: Network;
    private cacheService: CacheService;
    private unbondingCheckInterval: NodeJS.Timeout | null = null;

    /**
     * Private constructor to enforce singleton pattern per network
     */
    private constructor(network: Network) {
        this.network = network;
        this.babylonClient = BabylonClient.getInstance(network);
        this.cacheService = CacheService.getInstance();
    }

    /**
     * Gets the singleton instance for a specific network
     */
    public static getInstance(network: Network = Network.MAINNET): BBNStakeIndexer {
        if (!BBNStakeIndexer.instances.has(network)) {
            BBNStakeIndexer.instances.set(network, new BBNStakeIndexer(network));
        }
        return BBNStakeIndexer.instances.get(network)!;
    }

    /**
     * Starts the indexer
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn(`BBNStakeIndexer for ${this.network} is already running`);
            return;
        }
        
        logger.info(`Starting BBNStakeIndexer for network: ${this.network}`);
        
        try {
            // Set the running flag
            this.isRunning = true;
            
            // Set up websocket listeners for real-time updates
            this.setupWebsocketListeners();
            
            // Sync historical data
            await this.syncHistoricalData();
            
            // Set up interval to check for completed unbonding periods
            this.setupUnbondingCheck();
            
            logger.info(`BBNStakeIndexer started successfully for network: ${this.network}`);
        } catch (error) {
            this.isRunning = false;
            logger.error(`Error starting BBNStakeIndexer for network ${this.network}:`, error);
            throw error;
        }
    }

    /**
     * Stops the indexer
     */
    public stop(): void {
        if (!this.isRunning) {
            logger.warn('BBNStakeIndexer is not running');
            return;
        }

        this.isRunning = false;
        logger.info('Stopping BBNStakeIndexer');
        
        try {
            // Clean up websocket subscriptions
            const websocketService = WebsocketService.getInstance();
            websocketService.unsubscribeAll(`bbn_stake_indexer_${this.network}`);
            
            // Cancel any pending tasks
            // Clear any intervals that might have been set
            if (this.unbondingCheckInterval) {
                clearInterval(this.unbondingCheckInterval);
                this.unbondingCheckInterval = null;
            }
            
            // Release any locks or resources
            this.cacheService.del(`bbn_stake_indexer_lock_${this.network}`);
            
            logger.info('BBNStakeIndexer stopped successfully');
        } catch (error) {
            logger.error('Error while stopping BBNStakeIndexer:', error);
        }
    }

    /**
     * Sets up websocket listeners for new stakes and unbondings
     */
    private setupWebsocketListeners(): void {
        logger.info(`Setting up websocket listeners for BBN stake events on network: ${this.network}`);
        
        try {
            const websocketService = WebsocketService.getInstance();
            
            // Use a single subscription for both delegate and unbond events
            websocketService.subscribeToTx(
                `bbn_stake_indexer_${this.network}_staking`,
                this.network,
                {
                    'message.module': 'staking' // This covers both delegate and unbond operations
                },
                async (data: any) => {
                    logger.debug(`Received staking transaction: ${JSON.stringify(data)}`);
                    try {
                        // Get the full transaction details
                        const tx = await this.babylonClient.getTransaction(data.TxHash);
                        if (!tx) {
                            logger.warn(`Transaction ${data.TxHash} not found`);
                            return;
                        }
                        
                        // Determine if this is a delegate or unbond transaction
                        const msgType = tx.tx?.body?.messages?.[0]?.['@type'] || '';
                        
                        if (msgType.includes('MsgDelegate') || msgType.includes('delegate')) {
                            await this.processDelegateTransaction(tx);
                        } else if (msgType.includes('MsgUndelegate') || msgType.includes('unbond')) {
                            await this.processUnbondingTransaction(tx);
                        } else {
                            logger.debug(`Skipping non-delegate/unbond transaction: ${data.TxHash} with type ${msgType}`);
                        }
                    } catch (error) {
                        logger.error(`Error processing staking transaction from websocket: ${data.TxHash}`, error);
                    }
                }
            );
            
            logger.info(`Websocket listeners for BBN stake events set up successfully on network: ${this.network}`);
        } catch (error) {
            logger.error(`Error setting up websocket listeners for BBN stake events on network ${this.network}:`, error);
            throw error;
        }
    }

    /**
     * Syncs historical stake data
     */
    private async syncHistoricalData(): Promise<void> {
        logger.info(`Starting historical stake data sync for network: ${this.network}`);
        
        try {
            // Get the latest stake from the database to determine starting point
            const latestStake = await BBNStake.findOne({
                where: { networkType: this.network },
                order: [['startHeight', 'DESC']]
            });
            
            // Get the current block height from the client
            const currentBlock = await this.babylonClient.getLatestBlock();
            const currentHeight = currentBlock.header.height;
            
            // Determine the starting height (use 1 if no existing stakes)
            const startHeight = latestStake ? latestStake.startHeight + 1 : 1;
            
            logger.info(`Syncing stake data from block ${startHeight} to ${currentHeight} for network: ${this.network}`);
            
            // Process blocks in batches to avoid memory issues
            const BATCH_SIZE = 100;
            for (let height = startHeight; height <= currentHeight; height += BATCH_SIZE) {
                const endHeight = Math.min(height + BATCH_SIZE - 1, currentHeight);
                
                // Get delegate transactions in this block range
                const delegateTransactions = await this.babylonClient.getDelegateTransactions(height, endHeight);
                logger.info(`Found ${delegateTransactions.length} delegate transactions between blocks ${height} and ${endHeight}`);
                
                // Process delegate transactions
                for (const tx of delegateTransactions) {
                    await this.processDelegateTransaction(tx);
                }
                
                // Get unbonding transactions in this block range
                const unbondingTransactions = await this.babylonClient.getUnbondingTransactions(height, endHeight);
                logger.info(`Found ${unbondingTransactions.length} unbonding transactions between blocks ${height} and ${endHeight}`);
                
                // Process unbonding transactions
                for (const tx of unbondingTransactions) {
                    await this.processUnbondingTransaction(tx);
                }
                
                logger.info(`Completed syncing blocks ${height} to ${endHeight} for network: ${this.network}`);
            }
            
            logger.info(`Completed historical stake data sync for network: ${this.network}`);
        } catch (error) {
            logger.error(`Error syncing historical stake data for network ${this.network}:`, error);
            throw error;
        }
    }
    
    /**
     * Processes a delegate transaction and creates/updates stake records
     */
    private async processDelegateTransaction(tx: any): Promise<void> {
        try {
            // Extract stake data from transaction
            const stakerAddress = tx.sender;
            const validatorAddress = tx.message.validatorAddress;
            const amount = tx.message.amount;
            const denom = tx.message.denom;
            const blockHeight = tx.height;
            const timestamp = tx.timestamp;
            
            // Create or update stake record
            await this.createOrUpdateStake({
                txHash: tx.hash,
                stakerAddress,
                validatorAddress,
                amount,
                denom,
                startHeight: blockHeight,
                startTimestamp: timestamp,
                unbondingTime: await this.babylonClient.getUnbondingPeriod(validatorAddress),
                status: BBNStakeStatus.ACTIVE,
                networkType: this.network,
                endTimestamp: 0,
                unbondingTxHash: ''
            });
            
            logger.debug(`Processed delegate transaction ${tx.hash} for staker ${stakerAddress}`);
        } catch (error) {
            logger.error(`Error processing delegate transaction:`, error);
        }
    }
    
    /**
     * Processes an unbonding transaction and updates stake records
     */
    private async processUnbondingTransaction(tx: any): Promise<void> {
        try {
            // Extract unbonding data from transaction
            const stakerAddress = tx.sender;
            const validatorAddress = tx.message.validatorAddress;
            const amount = tx.message.amount;
            const denom = tx.message.denom;
            const blockHeight = tx.height;
            const timestamp = tx.timestamp;
            
            // Find active stake from this staker to this validator
            const stake = await BBNStake.findOne({
                stakerAddress, 
                validatorAddress, 
                status: BBNStakeStatus.ACTIVE,
                networkType: this.network
            });
            
            if (stake) {
                // Calculate end timestamp based on unbonding period
                const endTimestamp = new Date(timestamp);
                if (stake.unbondingTime) {
                    endTimestamp.setSeconds(endTimestamp.getSeconds() + stake.unbondingTime);
                } else {
                    // Default to 21 days if unbondingTime is not set
                    endTimestamp.setSeconds(endTimestamp.getSeconds() + (21 * 24 * 60 * 60));
                }
                
                // Update stake status
                stake.status = BBNStakeStatus.UNBONDING;
                stake.unbondingTxHash = tx.hash;
                stake.endTimestamp = Math.floor(endTimestamp.getTime() / 1000);
                await stake.save();
                
                logger.debug(`Updated stake ${stake.id} to UNBONDING status for staker ${stakerAddress}`);
            } else {
                logger.warn(`Could not find active stake for staker ${stakerAddress} and validator ${validatorAddress} to unbond`);
            }
        } catch (error) {
            logger.error(`Error processing unbonding transaction:`, error);
        }
    }

    /**
     * Sets up periodic check for completed unbondings
     */
    private setupUnbondingCheck(): void {
        // Check for completed unbondings every hour
        this.unbondingCheckInterval = setInterval(async () => {
            try {
                await this.checkCompletedUnbondings();
            } catch (error) {
                logger.error(`Error checking for completed unbondings for network ${this.network}:`, error);
            }
        }, 60 * 60 * 1000); // 1 hour
        
        logger.info(`Scheduled unbonding check for network: ${this.network}`);
    }
    
    /**
     * Checks for completed unbonding periods and updates stake statuses
     */
    private async checkCompletedUnbondings(): Promise<void> {
        logger.info(`Checking for completed unbonding periods for network: ${this.network}`);
        
        try {
            const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
            
            // Find unbonding stakes that have completed their unbonding period
            const completedUnbondings = await BBNStake.find({
                status: BBNStakeStatus.UNBONDING,
                endTimestamp: { $lte: now },
                networkType: this.network
            });
            
            logger.info(`Found ${completedUnbondings.length} completed unbondings for network: ${this.network}`);
            
            // Update each completed unbonding
            for (const stake of completedUnbondings) {
                stake.status = BBNStakeStatus.UNBONDED;
                await stake.save();
                
                logger.debug(`Updated stake ${stake.id} from UNBONDING to UNBONDED`);
            }
        } catch (error) {
            logger.error(`Error checking completed unbondings for network ${this.network}:`, error);
            throw error;
        }
    }

    /**
     * Processes a stake transaction and saves it to the database
     */
    public async processStake(stakeData: BBNStakeData): Promise<void> {
        try {
            logger.debug(`Processing stake: ${stakeData.txHash}`);
            
            // Check if stake already exists
            const existingStake = await BBNStake.findOne({ txHash: stakeData.txHash });
            if (existingStake) {
                logger.debug(`Stake ${stakeData.txHash} already exists, skipping`);
                return;
            }
            
            // Create new stake
            const stake = new BBNStake({
                txHash: stakeData.txHash,
                stakerAddress: stakeData.stakerAddress,
                validatorAddress: stakeData.validatorAddress,
                amount: stakeData.amount,
                denom: stakeData.denom,
                startHeight: stakeData.startHeight,
                startTimestamp: stakeData.startTimestamp,
                status: stakeData.status,
                networkType: this.network,
                unbondingTime: stakeData.unbondingTime,
                endTimestamp: stakeData.endTimestamp,
                unbondingTxHash: stakeData.unbondingTxHash
            });
            
            await stake.save();
            
            // Update staker account
            await this.updateStakerAccount(stakeData);
            
            logger.info(`Saved stake ${stakeData.txHash} to database`);
        } catch (error) {
            logger.error(`Error processing stake ${stakeData.txHash}:`, error);
        }
    }

    /**
     * Processes stake unbonding
     */
    public async processUnbonding(
        stakerAddress: string, 
        validatorAddress: string, 
        unbondingTxHash: string, 
        unbondingTime: number
    ): Promise<void> {
        try {
            logger.info(`Processing unbonding for staker ${stakerAddress} from validator ${validatorAddress}`);
            
            // Find the active stake
            const stake = await BBNStake.findOne({
                stakerAddress, 
                validatorAddress, 
                status: BBNStakeStatus.ACTIVE,
                networkType: this.network
            }).sort({ startTimestamp: -1 });
            
            if (!stake) {
                logger.warn(`No active stake found for staker ${stakerAddress} and validator ${validatorAddress}`);
                return;
            }
            
            // Update stake to unbonding
            stake.status = BBNStakeStatus.UNBONDING;
            stake.unbondingTime = unbondingTime;
            stake.unbondingTxHash = unbondingTxHash;
            
            await stake.save();
            
            logger.info(`Updated stake ${stake.txHash} to UNBONDING`);
            
            // Update staker account
            await this.updateStakerAccountAfterUnbonding(stake.stakerAddress, stake.amount);
        } catch (error) {
            logger.error(`Error processing unbonding for staker ${stakerAddress}:`, error);
        }
    }

    /**
     * Updates staker account when a new stake is created
     */
    private async updateStakerAccount(stakeData: BBNStakeData): Promise<void> {
        try {
            // Find staker account
            let account = await BBNAccount.findOne({ 
                address: stakeData.stakerAddress,
                networkType: this.network
            });
            
            if (!account) {
                // Create new account if it doesn't exist
                account = new BBNAccount({
                    address: stakeData.stakerAddress,
                    balance: 0, // Will be updated from chain
                    totalStaked: stakeData.amount,
                    lastActivityTimestamp: stakeData.startTimestamp,
                    lastActivityBlockHeight: stakeData.startHeight,
                    networkType: this.network,
                    txCount: 1,
                    isActive: true,
                    firstActivityTimestamp: stakeData.startTimestamp
                });
            } else {
                // Update existing account
                account.totalStaked += stakeData.amount;
                account.lastActivityTimestamp = Math.max(account.lastActivityTimestamp, stakeData.startTimestamp);
                account.lastActivityBlockHeight = Math.max(account.lastActivityBlockHeight, stakeData.startHeight);
                account.txCount += 1;
                account.isActive = true;
            }
            
            await account.save();
            logger.debug(`Updated staker account ${stakeData.stakerAddress}`);
        } catch (error) {
            logger.error(`Error updating staker account ${stakeData.stakerAddress}:`, error);
        }
    }

    /**
     * Updates staker account after unbonding
     */
    private async updateStakerAccountAfterUnbonding(
        stakerAddress: string, 
        amount: number
    ): Promise<void> {
        try {
            // Find staker account
            const account = await BBNAccount.findOne({ 
                address: stakerAddress,
                networkType: this.network
            });
            
            if (!account) {
                logger.warn(`No account found for staker ${stakerAddress}`);
                return;
            }
            
            // Update account
            account.totalStaked = Math.max(0, account.totalStaked - amount);
            await account.save();
            
            logger.debug(`Updated staker account ${stakerAddress} after unbonding`);
        } catch (error) {
            logger.error(`Error updating staker account ${stakerAddress} after unbonding:`, error);
        }
    }

    /**
     * Gets stakes from database
     */
    public async getStakes(
        options: {
            network?: Network,
            stakerAddress?: string,
            validatorAddress?: string,
            status?: BBNStakeStatus,
            startTime?: number,
            endTime?: number,
            page?: number,
            limit?: number
        } = {}
    ): Promise<{
        stakes: any[],
        total: number,
        page: number,
        totalPages: number
    }> {
        try {
            const {
                network = this.network,
                stakerAddress,
                validatorAddress,
                status,
                startTime,
                endTime,
                page = 1,
                limit = 20
            } = options;

            const query: any = { networkType: network };

            // Add filters if provided
            if (stakerAddress) {
                query.stakerAddress = stakerAddress;
            }
            
            if (validatorAddress) {
                query.validatorAddress = validatorAddress;
            }
            
            if (status) {
                query.status = status;
            }
            
            if (startTime || endTime) {
                query.startTimestamp = {};
                if (startTime) query.startTimestamp.$gte = startTime;
                if (endTime) query.startTimestamp.$lte = endTime;
            }

            // Get total count for pagination
            const total = await BBNStake.countDocuments(query);
            
            // Apply pagination
            const skip = (page - 1) * limit;
            
            // Get stakes
            const stakes = await BBNStake.find(query)
                .sort({ startTimestamp: -1 })
                .skip(skip)
                .limit(limit);

            const totalPages = Math.ceil(total / limit);
            
            return {
                stakes,
                total,
                page,
                totalPages
            };
        } catch (error) {
            logger.error('Error getting stakes:', error);
            throw error;
        }
    }

    /**
     * Create or update a stake record
     */
    private async createOrUpdateStake(stakeData: BBNStakeData): Promise<void> {
        try {
            logger.debug(`Creating/updating stake for staker ${stakeData.stakerAddress} and validator ${stakeData.validatorAddress}`);
            
            // Check if stake already exists
            const existingStake = await BBNStake.findOne({ txHash: stakeData.txHash });
            if (existingStake) {
                logger.debug(`Stake ${stakeData.txHash} already exists, skipping`);
                return;
            }
            
            // Create new stake
            const stake = new BBNStake({
                txHash: stakeData.txHash,
                stakerAddress: stakeData.stakerAddress,
                validatorAddress: stakeData.validatorAddress,
                amount: stakeData.amount,
                denom: stakeData.denom,
                startHeight: stakeData.startHeight,
                startTimestamp: stakeData.startTimestamp,
                status: stakeData.status,
                networkType: this.network,
                unbondingTime: stakeData.unbondingTime,
                endTimestamp: stakeData.endTimestamp,
                unbondingTxHash: stakeData.unbondingTxHash
            });
            
            await stake.save();
            
            // Update staker account
            await this.updateStakerAccount(stakeData);
            
            logger.info(`Saved stake ${stakeData.txHash} to database`);
        } catch (error) {
            logger.error(`Error creating/updating stake ${stakeData.txHash}:`, error);
        }
    }
} 