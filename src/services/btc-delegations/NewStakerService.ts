import { logger } from '../../utils/logger';
import { StakerUtils } from './utils/StakerUtils';
import { StakerManagementService } from './StakerManagementService';
import { DelegationDetailsService } from './DelegationDetailsService';
import { StakerStatsService } from './StakerStatsService';
import { StakerQueryService } from './StakerQueryService';
import { StakerRecalculationService } from './StakerRecalculationService';
import { RecentDelegation } from './interfaces/StakerInterfaces';
import { NewStaker } from '../../database/models/NewStaker';

export class NewStakerService {
    private static instance: NewStakerService | null = null;
    private stakerManagementService: StakerManagementService;
    private delegationDetailsService: DelegationDetailsService;
    private stakerStatsService: StakerStatsService;
    private stakerQueryService: StakerQueryService;
    private stakerRecalculationService: StakerRecalculationService;

    private constructor() {
        this.stakerManagementService = StakerManagementService.getInstance();
        this.delegationDetailsService = DelegationDetailsService.getInstance();
        this.stakerStatsService = StakerStatsService.getInstance();
        this.stakerQueryService = StakerQueryService.getInstance();
        this.stakerRecalculationService = StakerRecalculationService.getInstance();
    }

    public static getInstance(): NewStakerService {
        if (!NewStakerService.instance) {
            NewStakerService.instance = new NewStakerService();
        }
        return NewStakerService.instance;
    }

    /**
     * Updates staker information when a new delegation is added or updated
     * @param delegation Delegation data
     */
    public async updateStakerFromDelegation(delegation: any): Promise<void> {
        const maxRetries = 3;
        let retryCount = 0;
        let success = false;
        let stakerId: any = null;

        while (!success && retryCount < maxRetries) {
            try {
                const { 
                    stakerAddress, 
                    stakerBtcAddress, 
                    stakerBtcPkHex, 
                    state, 
                    networkType, 
                    totalSat, 
                    stakingTime, 
                    stakingTxIdHex, 
                    txHash,
                    paramsVersion
                } = delegation;

                // Calculate phase
                const phase = StakerUtils.calculatePhase(paramsVersion);

                // Find or create staker - on first attempt or if we don't have stakerId yet
                let staker;
                if (retryCount === 0 || !stakerId) {
                    staker = await this.stakerManagementService.findOrCreateStaker(
                        stakerAddress,
                        stakerBtcAddress,
                        stakerBtcPkHex,
                        stakingTime
                    );
                    if (staker._id) {
                        stakerId = staker._id;
                    }
                } else {
                    // On retry attempts, fetch the fresh document directly by ID to avoid version conflicts
                    staker = await NewStaker.findById(stakerId);
                    
                    if (!staker) {
                        throw new Error(`Failed to find staker with ID ${stakerId} during retry`);
                    }
                }

                // Update recent delegations
                const recentDelegation: RecentDelegation = {
                    stakingTxIdHex,
                    txHash: StakerUtils.formatTxHash(txHash, stakingTxIdHex),
                    state,  
                    networkType,
                    totalSat,
                    stakingTime,
                    createdAt: delegation.createdAt ? new Date(delegation.createdAt) : new Date(),
                    updatedAt: new Date()
                };
                this.stakerManagementService.updateRecentDelegations(staker, recentDelegation);

                // Update delegation details
                await this.delegationDetailsService.updateDelegationDetails(staker, delegation, phase);

                // Update staker statistics
                await this.stakerStatsService.updateStakerStats(staker, delegation, phase);

                // Recalculate totals to ensure consistency
                this.recalculateTotals(staker);

                // Set last updated time
                staker.lastUpdated = new Date();

                // Save staker with optimistic concurrency control handling
                await staker.save();
                success = true;
            } catch (error: any) {
                retryCount++;
                
                // If it's a version error, we should retry with a fresh document
                if (error.name === 'VersionError' && retryCount < maxRetries) {
                    logger.warn(`Staker version conflict detected (attempt ${retryCount}/${maxRetries}), retrying with fresh document...`);
                    
                    // Add a small delay before retrying to reduce contention
                    await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
                    
                    // Continue to next retry attempt
                    continue;
                }
                
                // For other errors or if we've exceeded max retries, log and throw
                logger.error(`Error updating staker from delegation: ${error}`);
                throw error;
            }
        }
    }

    /**
     * Recalculates total statistics for a staker to ensure consistency
     * @param staker Staker document
     */
    private recalculateTotals(staker: any): void {
        try {
            // Reset counters
            staker.totalDelegationsCount = 0;
            staker.activeDelegationsCount = 0;
            staker.totalStakedSat = 0;
            staker.activeStakedSat = 0;
            
            // Reset delegation states
            if (!staker.delegationStates) {
                staker.delegationStates = {
                    PENDING: 0,
                    VERIFIED: 0,
                    ACTIVE: 0,
                    UNBONDED: 0
                };
            } else {
                staker.delegationStates.PENDING = 0;
                staker.delegationStates.VERIFIED = 0;
                staker.delegationStates.ACTIVE = 0;
                staker.delegationStates.UNBONDED = 0;
            }
            
            // Reset network stats
            if (!staker.networkStats) {
                staker.networkStats = {
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
                };
            } else {
                Object.keys(staker.networkStats).forEach(network => {
                    staker.networkStats[network].totalDelegations = 0;
                    staker.networkStats[network].activeDelegations = 0;
                    staker.networkStats[network].totalStakedSat = 0;
                    staker.networkStats[network].activeStakedSat = 0;
                });
            }
            
            // Recalculate based on delegations array
            if (staker.delegations && Array.isArray(staker.delegations)) {
                staker.delegations.forEach((delegation: any) => {
                    // Update total counts
                    staker.totalDelegationsCount += 1;
                    staker.totalStakedSat += delegation.totalSat || 0;
                    staker.delegationStates[delegation.state] = (staker.delegationStates[delegation.state] || 0) + 1;
                    
                    // Update network stats
                    if (staker.networkStats && staker.networkStats[delegation.networkType]) {
                        staker.networkStats[delegation.networkType].totalDelegations += 1;
                        staker.networkStats[delegation.networkType].totalStakedSat += delegation.totalSat || 0;
                    }
                    
                    // Update active counts
                    if (delegation.state === 'ACTIVE') {
                        staker.activeDelegationsCount += 1;
                        staker.activeStakedSat += delegation.totalSat || 0;
                        
                        // Update network stats for active
                        if (staker.networkStats && staker.networkStats[delegation.networkType]) {
                            staker.networkStats[delegation.networkType].activeDelegations += 1;
                            staker.networkStats[delegation.networkType].activeStakedSat += delegation.totalSat || 0;
                        }
                    }
                });
            }
            
            logger.info(`Recalculated totals for staker ${staker.stakerAddress}: 
                Total Delegations: ${staker.totalDelegationsCount}, 
                Active Delegations: ${staker.activeDelegationsCount}`);
        } catch (error) {
            logger.error(`Error recalculating totals for staker: ${error}`);
            // We don't throw here to allow the main update to continue
        }
    }

    /**
     * Recalculates all staker statistics
     * This method can be used to fix database inconsistencies
     */
    public async recalculateAllStakerStats(): Promise<void> {
        return this.stakerRecalculationService.recalculateAllStakerStats();
    }

    /**
     * Creates stakers from delegations
     * This method is used to create stakers from delegations
     */
    public async createStakersFromDelegations(): Promise<void> {
        return this.stakerManagementService.createStakersFromDelegations();
    }

    /**
     * Gets all stakers
     * @param limit Limit
     * @param skip Number of records to skip
     * @param sortField Sort field
     * @param sortOrder Sort order (asc/desc)
     */
    public async getAllStakers(limit = 10, skip = 0, sortField = 'totalStakedSat', sortOrder = 'desc'): Promise<any[]> {
        return this.stakerQueryService.getAllStakers(limit, skip, sortField, sortOrder);
    }

    /**
     * Gets stakers summary with only essential fields
     * @param limit Limit
     * @param skip Number of records to skip
     * @param sortField Sort field
     * @param sortOrder Sort order (asc/desc)
     */
    public async getStakersSummary(limit = 10, skip = 0, sortField = 'totalStakedSat', sortOrder = 'desc'): Promise<any[]> {
        return this.stakerQueryService.getStakersSummary(limit, skip, sortField, sortOrder);
    }

    /**
     * Gets the total number of stakers
     */
    public async getStakersCount(): Promise<number> {
        return this.stakerQueryService.getStakersCount();
    }

    /**
     * Gets a staker by ID
     * @param stakerAddress Staker address
     */
    public async getStakerByAddress(stakerAddress: string): Promise<any> {
        return this.stakerQueryService.getStakerByAddress(stakerAddress);
    }

    /**
     * Gets a staker's delegations
     * @param stakerAddress Staker address
     * @param limit Limit
     * @param skip Number of records to skip
     * @param sortField Sort field
     * @param sortOrder Sort order (asc/desc)
     */
    public async getStakerDelegations(
        stakerAddress: string, 
        limit = 10, 
        skip = 0, 
        sortField = 'stakingTime', 
        sortOrder = 'desc'
    ): Promise<any[]> {
        return this.stakerQueryService.getStakerDelegations(stakerAddress, limit, skip, sortField, sortOrder);
    }

    /**
     * Gets a staker's phase-based statistics
     * @param stakerAddress Staker address
     * @param phase Phase value (optional)
     */
    public async getStakerPhaseStats(stakerAddress: string, phase?: number): Promise<any[]> {
        return this.stakerQueryService.getStakerPhaseStats(stakerAddress, phase);
    }

    /**
     * Gets a staker's unique finality providers
     * @param stakerAddress Staker address
     */
    public async getStakerUniqueFinalityProviders(stakerAddress: string): Promise<any[]> {
        return this.stakerQueryService.getStakerUniqueFinalityProviders(stakerAddress);
    }

    /**
     * Gets the total amount of BTC staked across all stakers
     * @returns Total staked amount in satoshis
     */
    public async getTotalStakedAmount(): Promise<number> {
        return this.stakerQueryService.getTotalStakedAmount();
    }

    /**
     * Gets the average stake amount across all delegations
     * @returns Average stake amount in satoshis
     */
    public async getAverageStakeAmount(): Promise<number> {
        return this.stakerQueryService.getAverageStakeAmount();
    }

    /**
     * Gets the count of unique finality providers across all stakers
     * @returns Count of unique finality providers
     */
    public async getUniqueProvidersCount(): Promise<number> {
        return this.stakerQueryService.getUniqueProvidersCount();
    }
}