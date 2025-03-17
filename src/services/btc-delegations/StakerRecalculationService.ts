import { NewStaker } from '../../database/models/NewStaker';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { logger } from '../../utils/logger';
import { StakerUtils } from './utils/StakerUtils';
import { RecentDelegation } from './interfaces/StakerInterfaces';
import { StakerStatsService } from './StakerStatsService';
import { DelegationDetailsService } from './DelegationDetailsService';

export class StakerRecalculationService {
    private static instance: StakerRecalculationService | null = null;
    private stakerStatsService: StakerStatsService;
    private delegationDetailsService: DelegationDetailsService;

    private constructor() {
        this.stakerStatsService = StakerStatsService.getInstance();
        this.delegationDetailsService = DelegationDetailsService.getInstance();
    }

    public static getInstance(): StakerRecalculationService {
        if (!StakerRecalculationService.instance) {
            StakerRecalculationService.instance = new StakerRecalculationService();
        }
        return StakerRecalculationService.instance;
    }

    /**
     * Recalculates all staker statistics
     * This method can be used to correct database inconsistencies
     */
    public async recalculateAllStakerStats(): Promise<void> {
        try {
            logger.info('Starting recalculation of all staker statistics...');
            
            // Get all stakers
            const stakerCount = await NewStaker.countDocuments({});
            logger.info(`Found ${stakerCount} stakers to process`);
            
            // Batch size for processing
            const batchSize = 50;
            let processedCount = 0;
            
            // Process stakers in batches
            for (let skip = 0; skip < stakerCount; skip += batchSize) {
                const stakers = await NewStaker.find({})
                    .skip(skip)
                    .limit(batchSize);
                
                // Update statistics for each staker
                for (const staker of stakers) {
                    try {
                        await this.recalculateStakerStats(staker);
                        logger.info(`Recalculated stats for staker: ${staker.stakerAddress}`);
                    } catch (error) {
                        logger.error(`Error recalculating stats for staker ${staker.stakerAddress}: ${error}`);
                    }
                }
                
                processedCount += stakers.length;
                logger.info(`Processed ${processedCount}/${stakerCount} stakers`);
            }
            
            logger.info('Completed recalculation of all staker statistics');
        } catch (error) {
            logger.error(`Error recalculating staker statistics: ${error}`);
            throw error;
        }
    }

    /**
     * Recalculates the statistics of a staker
     * @param staker Staker document
     */
    public async recalculateStakerStats(staker: any): Promise<void> {
        try {
            // Reset all staker statistics
            this.stakerStatsService.resetStakerStats(staker);
            
            // Reset delegation details
            if (staker.delegations) {
                staker.delegations.splice(0);
            }
            
            // Get all delegations of the staker
            const delegations = await NewBTCDelegation.find({ stakerAddress: staker.stakerAddress });
            
            // Reset first and last staking times
            staker.firstStakingTime = null;
            staker.lastStakingTime = null;
            
            // Clear recent delegations
            if (staker.recentDelegations) {
                staker.recentDelegations.splice(0);
            }
            
            // Create temporary array
            const tempRecentDelegations: RecentDelegation[] = [];
            
            // Update statistics for each delegation
            for (const delegation of delegations) {
                // Calculate phase - check for null or undefined
                const paramsVersion = delegation.paramsVersion !== null && delegation.paramsVersion !== undefined ? 
                    delegation.paramsVersion : undefined;
                const phase = StakerUtils.calculatePhase(paramsVersion);
                
                // Update first and last staking times
                if (!staker.firstStakingTime || (delegation.createdAt && new Date(delegation.createdAt).getTime() < staker.firstStakingTime)) {
                    staker.firstStakingTime = delegation.createdAt ? new Date(delegation.createdAt).getTime() : delegation.stakingTime;
                }
                if (!staker.lastStakingTime || (delegation.createdAt && new Date(delegation.createdAt).getTime() > staker.lastStakingTime)) {
                    staker.lastStakingTime = delegation.createdAt ? new Date(delegation.createdAt).getTime() : delegation.stakingTime;
                }
                
                // Add delegation detail
                const delegationDetail = this.delegationDetailsService.createDelegationDetail(delegation, phase);
                staker.delegations.push(delegationDetail);
                
                // Increase total counts
                staker.totalDelegationsCount += 1;
                staker.totalStakedSat += delegation.totalSat;
                staker.delegationStates[delegation.state] += 1;
                
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
                }
                
                // Update phase-based statistics
                this.stakerStatsService.updatePhaseStats(
                    staker, 
                    phase, 
                    delegation.networkType, 
                    delegation.finalityProviderBtcPksHex[0], 
                    delegation.totalSat, 
                    delegation.state === 'ACTIVE', 
                    true
                );
                
                // Update unique finality provider statistics
                this.stakerStatsService.updateUniqueFinalityProviders(
                    staker, 
                    delegation.finalityProviderBtcPksHex[0], 
                    delegation.totalSat
                );
                
                // Update recent delegations (maximum 10)
                if (tempRecentDelegations.length < 10) {
                    tempRecentDelegations.push({
                        stakingTxIdHex: delegation.stakingTxIdHex,
                        txHash: StakerUtils.formatTxHash(delegation.txHash, delegation.stakingTxIdHex),
                        state: delegation.state,
                        networkType: delegation.networkType,
                        totalSat: delegation.totalSat,
                        stakingTime: delegation.stakingTime
                    });
                }
            }
            
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
            StakerUtils.logError(`Error recalculating stats for staker: ${staker.stakerAddress}`, error);
            throw error;
        }
    }
}