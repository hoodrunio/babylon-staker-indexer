import { NewStaker } from '../../database/models/NewStaker';
import { StakerUtils } from './utils/StakerUtils';

export class StakerQueryService {
    private static instance: StakerQueryService | null = null;

    private constructor() {}

    public static getInstance(): StakerQueryService {
        if (!StakerQueryService.instance) {
            StakerQueryService.instance = new StakerQueryService();
        }
        return StakerQueryService.instance;
    }

    /**
     * Gets all stakers
     * @param limit Limit
     * @param skip Number of records to skip
     * @param sortField Sort field
     * @param sortOrder Sort order (asc/desc)
     */
    public async getAllStakers(limit = 10, skip = 0, sortField = 'totalStakedSat', sortOrder = 'desc'): Promise<any[]> {
        try {
            const sort: any = {};
            sort[sortField] = sortOrder === 'asc' ? 1 : -1;
            
            return NewStaker.find({})
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean();
        } catch (error) {
            StakerUtils.logError('Error getting all stakers', error);
            throw error;
        }
    }

    /**
     * Gets stakers summary with only essential fields
     * @param limit Limit
     * @param skip Number of records to skip
     * @param sortField Sort field
     * @param sortOrder Sort order (asc/desc)
     */
    public async getStakersSummary(limit = 10, skip = 0, sortField = 'totalStakedSat', sortOrder = 'desc'): Promise<any[]> {
        try {
            const sort: any = {};
            sort[sortField] = sortOrder === 'asc' ? 1 : -1;
            
            return NewStaker.find({}, {
                stakerAddress: 1,
                stakerBtcAddress: 1,
                stakerBtcPkHex: 1,
                totalStakedSat: 1,
                totalDelegationsCount: 1,
                uniqueFinalityProviders: 1
            })
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean()
                .then(stakers => stakers.map(staker => ({
                    stakerAddress: staker.stakerAddress,
                    stakerBtcAddress: staker.stakerBtcAddress,
                    stakerBtcPkHex: staker.stakerBtcPkHex,
                    totalStake: staker.totalStakedSat,
                    averageStake: staker.totalDelegationsCount > 0 ? Math.floor(staker.totalStakedSat / staker.totalDelegationsCount) : 0,
                    transactionsCount: staker.totalDelegationsCount,
                    providersCount: staker.uniqueFinalityProviders ? staker.uniqueFinalityProviders.length : 0
                })));
        } catch (error) {
            StakerUtils.logError('Error getting stakers summary', error);
            throw error;
        }
    }

    /**
     * Gets the total number of stakers
     */
    public async getStakersCount(): Promise<number> {
        try {
            return NewStaker.countDocuments({});
        } catch (error) {
            StakerUtils.logError('Error getting stakers count', error);
            throw error;
        }
    }

    /**
     * Gets a staker by address (supports both Babylon and BTC addresses)
     * @param address Staker address (can be either Babylon or BTC address)
     */
    public async getStakerByAddress(address: string): Promise<any> {
        try {
            // First try to find by Babylon address
            let staker = await NewStaker.findOne({ stakerAddress: address }).lean();
            
            // If not found and the address doesn't start with 'bbn1', try finding by BTC address
            if (!staker && !address.startsWith('bbn1')) {
                staker = await NewStaker.findOne({ stakerBtcAddress: address }).lean();
            }
            
            return staker;
        } catch (error) {
            StakerUtils.logError(`Error getting staker by address: ${address}`, error);
            throw error;
        }
    }

    /**
     * Gets a staker's delegations
     * @param address Staker address (can be either Babylon or BTC address)
     * @param limit Limit
     * @param skip Number of records to skip
     * @param sortField Sort field
     * @param sortOrder Sort order (asc/desc)
     */
    public async getStakerDelegations(
        address: string, 
        limit = 10, 
        skip = 0, 
        sortField = 'stakingTime', 
        sortOrder = 'desc'
    ): Promise<any[]> {
        try {
            const staker = await this.getStakerByAddress(address);
            
            if (!staker || !staker.delegations || staker.delegations.length === 0) {
                return [];
            }
            
            // Sort delegations based on the sort field
            const sortedDelegations = [...staker.delegations].sort((a, b) => {
                const aValue = a[sortField as keyof typeof a];
                const bValue = b[sortField as keyof typeof b];
                
                if (typeof aValue === 'number' && typeof bValue === 'number') {
                    return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
                }
                
                return 0;
            });
            
            // Apply pagination
            return sortedDelegations.slice(skip, skip + limit);
        } catch (error) {
            StakerUtils.logError(`Error getting staker delegations: ${address}`, error);
            throw error;
        }
    }

    /**
     * Gets a staker's phase-based statistics
     * @param address Staker address (can be either Babylon or BTC address)
     * @param phase Phase value (optional)
     */
    public async getStakerPhaseStats(address: string, phase?: number): Promise<any[]> {
        try {
            const staker = await this.getStakerByAddress(address);
            
            if (!staker || !staker.phaseStats) {
                return [];
            }
            
            if (phase !== undefined) {
                const phaseStats = staker.phaseStats.find((p: any) => p.phase === phase);
                return phaseStats ? [phaseStats] : [];
            }
            
            return staker.phaseStats;
        } catch (error) {
            StakerUtils.logError(`Error getting staker phase stats: ${address}`, error);
            throw error;
        }
    }

    /**
     * Gets a staker's unique finality providers
     * @param address Staker address (can be either Babylon or BTC address)
     */
    public async getStakerUniqueFinalityProviders(address: string): Promise<any[]> {
        try {
            const staker = await this.getStakerByAddress(address);
            
            if (!staker || !staker.uniqueFinalityProviders) {
                return [];
            }
            
            return staker.uniqueFinalityProviders;
        } catch (error) {
            StakerUtils.logError(`Error getting staker unique finality providers: ${address}`, error);
            throw error;
        }
    }

    /**
     * Gets the total amount of BTC staked across all stakers
     * @returns Total staked amount in satoshis
     */
    public async getTotalStakedAmount(): Promise<number> {
        try {
            const result = await NewStaker.aggregate([
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: '$totalStakedSat' }
                    }
                }
            ]);
            
            return result.length > 0 ? result[0].totalAmount : 0;
        } catch (error) {
            StakerUtils.logError('Error getting total staked amount', error);
            throw error;
        }
    }

    /**
     * Gets the average stake amount across all stakers
     * @returns Average stake amount in satoshis
     */
    public async getAverageStakeAmount(): Promise<number> {
        try {
            const result = await NewStaker.aggregate([
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: '$totalStakedSat' },
                        totalDelegations: { $sum: '$totalDelegationsCount' }
                    }
                },
                {
                    $project: {
                        averageStake: {
                            $cond: [
                                { $gt: ['$totalDelegations', 0] },
                                { $divide: ['$totalAmount', '$totalDelegations'] },
                                0
                            ]
                        }
                    }
                }
            ]);
            
            return result.length > 0 ? Math.floor(result[0].averageStake) : 0;
        } catch (error) {
            StakerUtils.logError('Error getting average stake amount', error);
            throw error;
        }
    }

    /**
     * Gets the count of unique finality providers across all stakers
     * @returns Count of unique finality providers
     */
    public async getUniqueProvidersCount(): Promise<number> {
        try {
            const result = await NewStaker.aggregate([
                { $unwind: '$uniqueFinalityProviders' },
                { $group: { _id: '$uniqueFinalityProviders.btcPkHex' } },
                { $count: 'total' }
            ]);
            
            return result.length > 0 ? result[0].total : 0;
        } catch (error) {
            StakerUtils.logError('Error getting unique providers count', error);
            throw error;
        }
    }
}