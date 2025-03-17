import { NewStaker } from '../../database/models/NewStaker';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { logger } from '../../utils/logger';
import { StakerUtils } from './utils/StakerUtils';
import { RecentDelegation } from './interfaces/StakerInterfaces';

export class StakerManagementService {
    private static instance: StakerManagementService | null = null;

    private constructor() {}

    public static getInstance(): StakerManagementService {
        if (!StakerManagementService.instance) {
            StakerManagementService.instance = new StakerManagementService();
        }
        return StakerManagementService.instance;
    }

    /**
     * Finds or creates a staker
     * @param stakerAddress Staker address
     * @param stakerBtcAddress Staker BTC address
     * @param stakerBtcPkHex Staker BTC public key
     * @param stakingTime Staking time
     */
    public async findOrCreateStaker(
        stakerAddress: string,
        stakerBtcAddress: string,
        stakerBtcPkHex: string,
        stakingTime: number
    ): Promise<any> {
        try {
            let staker = await NewStaker.findOne({ stakerAddress });
            
            if (!staker) {
                staker = new NewStaker({
                    stakerAddress,
                    stakerBtcAddress: stakerBtcAddress || '',
                    stakerBtcPkHex: stakerBtcPkHex || '',
                    firstStakingTime: stakingTime,
                    lastStakingTime: stakingTime,
                    delegations: [],
                    uniqueFinalityProviders: [],
                    phaseStats: []
                });
            } else {
                // Update Staker BTC information (if empty)
                if (!staker.stakerBtcAddress && stakerBtcAddress) {
                    staker.stakerBtcAddress = stakerBtcAddress;
                }
                if (!staker.stakerBtcPkHex && stakerBtcPkHex) {
                    staker.stakerBtcPkHex = stakerBtcPkHex;
                }

                // Update first and last staking times
                if (!staker.firstStakingTime || stakingTime < staker.firstStakingTime) {
                    staker.firstStakingTime = stakingTime;
                }
                if (!staker.lastStakingTime || stakingTime > staker.lastStakingTime) {
                    staker.lastStakingTime = stakingTime;
                }
            }
            
            return staker;
        } catch (error) {
            StakerUtils.logError('Error finding or creating staker', error);
            throw error;
        }
    }

    /**
     * Updates recent delegations
     * @param staker Staker document
     * @param newDelegation New delegation
     */
    public updateRecentDelegations(staker: any, newDelegation: RecentDelegation): void {
        try {
            // Get the current recentDelegations as an array and process it
            const currentDelegations: RecentDelegation[] = staker.recentDelegations ? 
                Array.from(staker.recentDelegations).map((d: any) => ({
                    stakingTxIdHex: d.stakingTxIdHex,
                    txHash: d.txHash,
                    state: d.state,
                    networkType: d.networkType,
                    totalSat: d.totalSat,
                    stakingTime: d.stakingTime
                })) : [];

            // If this delegation already exists, update it
            const existingIndex = currentDelegations.findIndex(d => d.stakingTxIdHex === newDelegation.stakingTxIdHex);
            if (existingIndex !== -1) {
                currentDelegations[existingIndex] = newDelegation;
            } else {
                // If not, add it and keep a maximum of 10
                currentDelegations.unshift(newDelegation);
                if (currentDelegations.length > 10) {
                    currentDelegations.splice(10);
                }
            }

            // Assign the updated recentDelegations to the staker
            // First, clear the existing array
            if (staker.recentDelegations) {
                staker.recentDelegations.splice(0);
            }
            
            // Then add the new values
            currentDelegations.forEach(d => {
                staker.recentDelegations.push(d);
            });
        } catch (error) {
            StakerUtils.logError('Error updating recent delegations', error);
            throw error;
        }
    }

    /**
     * Creates stakers from delegations
     * This method is used to create stakers from delegations
     */
    public async createStakersFromDelegations(): Promise<void> {
        try {
            logger.info('Starting to create stakers from delegations...');
            
            // Get all staker addresses (distinct)
            const stakerAddresses = await NewBTCDelegation.distinct('stakerAddress');
            
            logger.info(`Found ${stakerAddresses.length} unique staker addresses`);
            
            // Batch size for bulk processing
            const batchSize = 100;
            let processedCount = 0;
            let createdCount = 0;
            
            // Process staker addresses in batches
            for (let i = 0; i < stakerAddresses.length; i += batchSize) {
                const batch = stakerAddresses.slice(i, i + batchSize);
                
                // Parallel processing for each batch
                await Promise.all(batch.map(async (stakerAddress) => {
                    try {
                        // Check if the staker already exists
                        const existingStaker = await NewStaker.findOne({ stakerAddress });
                        
                        if (!existingStaker) {
                            // Get the first delegation of the staker
                            const firstDelegation = await NewBTCDelegation.findOne({ stakerAddress })
                                .sort({ createdAt: 1 })
                                .limit(1);
                            
                            if (firstDelegation) {
                                // Create a new staker
                                const newStaker = new NewStaker({
                                    stakerAddress,
                                    stakerBtcAddress: firstDelegation.stakerBtcAddress || '',
                                    stakerBtcPkHex: firstDelegation.stakerBtcPkHex || '',
                                    firstStakingTime: firstDelegation.createdAt ? new Date(firstDelegation.createdAt).getTime() : firstDelegation.stakingTime,
                                    lastStakingTime: firstDelegation.createdAt ? new Date(firstDelegation.createdAt).getTime() : firstDelegation.stakingTime,
                                    delegations: [],
                                    uniqueFinalityProviders: [],
                                    phaseStats: [],
                                    delegationStates: {
                                        PENDING: 0,
                                        VERIFIED: 0,
                                        ACTIVE: 0,
                                        UNBONDED: 0
                                    },
                                    networkStats: {
                                        mainnet: {
                                            totalDelegations: 0,
                                            activeDelegations: 0,
                                            totalStakedSat: 0,
                                            activeStakedSat: 0
                                        },
                                        testnet: {
                                            totalDelegations: 0,
                                            activeDelegations: 0,
                                            totalStakedSat: 0,
                                            activeStakedSat: 0
                                        }
                                    }
                                });
                                
                                // Save the staker
                                await newStaker.save();
                                createdCount++;
                            }
                        }
                    } catch (error) {
                        logger.error(`Error processing staker ${stakerAddress}: ${error}`);
                    }
                }));
                
                processedCount += batch.length;
                logger.info(`Processed ${processedCount}/${stakerAddresses.length} stakers, created ${createdCount} new stakers`);
            }
            
            logger.info(`Completed creating stakers from delegations. Created ${createdCount} new stakers`);
        } catch (error) {
            logger.error(`Error creating stakers from delegations: ${error}`);
            throw error;
        }
    }
}