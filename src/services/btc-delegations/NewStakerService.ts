import { logger } from '../../utils/logger';
import { StakerUtils } from './utils/StakerUtils';
import { StakerManagementService } from './StakerManagementService';
import { DelegationDetailsService } from './DelegationDetailsService';
import { StakerStatsService } from './StakerStatsService';
import { StakerQueryService } from './StakerQueryService';
import { StakerRecalculationService } from './StakerRecalculationService';
import { RecentDelegation } from './interfaces/StakerInterfaces';

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

            // Find or create staker
            let staker = await this.stakerManagementService.findOrCreateStaker(
                stakerAddress,
                stakerBtcAddress,
                stakerBtcPkHex,
                stakingTime
            );

            // Update recent delegations
            const recentDelegation: RecentDelegation = {
                stakingTxIdHex,
                txHash: StakerUtils.formatTxHash(txHash, stakingTxIdHex),
                state,  
                networkType,
                totalSat,
                stakingTime
            };
            this.stakerManagementService.updateRecentDelegations(staker, recentDelegation);

            // Update delegation details
            await this.delegationDetailsService.updateDelegationDetails(staker, delegation, phase);

            // Update staker statistics
            await this.stakerStatsService.updateStakerStats(staker, delegation, phase);

            // Set last updated time
            staker.lastUpdated = new Date();

            // Save staker
            await staker.save();
        } catch (error) {
            logger.error(`Error updating staker from delegation: ${error}`);
            throw error;
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