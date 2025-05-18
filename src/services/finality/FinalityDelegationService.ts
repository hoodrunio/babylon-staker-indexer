import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { 
    DelegationResponse,
    BTCDelegationStatus
} from '../../types/finality/btcstaking';
import { formatSatoshis } from '../../utils/util';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';
import { Document } from 'mongoose';
import { logger } from '../../utils/logger';

interface DelegationDocument extends Document {
    stakerAddress: string;
    stakerBtcAddress?: string;
    state: string;
    stakerBtcPkHex: string;
    totalSat: number;
    startHeight: number;
    endHeight?: number;
    stakingTime: number;
    stakingTxIdHex: string;
    stakingTxHex: string;
    unbondingTime: number;
    unbondingTxHex?: string;
    unbondingTxIdHex?: string;
    spendStakeTxHex?: string;
    spendStakeTxIdHex?: string;
}

export type SortOrder = 'asc' | 'desc';
export type SortField = 'amount' | 'startHeight' | 'createdAt';

export interface DelegationQueryOptions {
    status?: BTCDelegationStatus;
    sortBy?: SortField;
    sortOrder?: SortOrder;
    minAmount?: number;
    maxAmount?: number;
}

export class FinalityDelegationService {
    private static instance: FinalityDelegationService | null = null;
    private babylonClient: BabylonClient;
    private network: Network;

    private constructor() {
        this.babylonClient = BabylonClient.getInstance();
        this.network = this.babylonClient.getNetwork();
    }

    public static getInstance(): FinalityDelegationService {
        if (!FinalityDelegationService.instance) {
            FinalityDelegationService.instance = new FinalityDelegationService();
        }
        return FinalityDelegationService.instance;
    }


/* private processDelegation(del: BTCDelegation): DelegationResponse | null {
        if (!del) return null;

        const totalSat = Number(del.total_sat);
        if (isNaN(totalSat)) {
            logger.warn(`Invalid total_sat value for delegation:`, del);
            return null;
        }

        const response: DelegationResponse = {
            staker_address: del.staker_addr || '',
            stakerBtcAddress: del.stakerBtcAddress || '',
            status: del.status_desc || '',
            btc_pk_hex: del.btc_pk || '',
            amount: formatSatoshis(totalSat),
            amount_sat: totalSat,
            start_height: Number(del.start_height) || 0,
            end_height: Number(del.end_height) || 0,
            duration: Number(del.staking_time) || 0,
            transaction_id_hex: getTxHash(del.staking_tx_hex || '', false),
            transaction_id: del.staking_tx_hex || '',
            active: del.active,
            unbonding_time: del.unbonding_time
        };

        // Add unbonding information
        if (del.undelegation_response) {
            response.unbonding = {
                transaction_id: del.undelegation_response.unbonding_tx_hex,
                transaction_id_hex: getTxHash(del.undelegation_response.unbonding_tx_hex || '', false),
                spend_transaction_id: del.undelegation_response.delegator_unbonding_info?.spend_stake_tx_hex
            };
        }

        return response;
    } */

        
/* private async fetchDelegations(
        fpBtcPkHex: string,
        network: Network,
        pageKey?: string,
        pageLimit: number = 100
    ): Promise<{
        delegations: DelegationResponse[];
        next_key?: string;
    }> {
        const { nodeUrl } = this.getNetworkConfig(network);
        const url = new URL(`${nodeUrl}/babylon/btcstaking/v1/finality_providers/${fpBtcPkHex}/delegations`);
        
        url.searchParams.append('pagination.limit', pageLimit.toString());
        if (pageKey) {
            url.searchParams.append('pagination.key', pageKey);
        }

        const response = await fetch(url.toString());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json() as QueryFinalityProviderDelegationsResponse;
        
        const delegations = data.btc_delegator_delegations?.flatMap(delegation => {
            if (!delegation || !delegation.dels) return [];
            return delegation.dels.map(del => this.processDelegation(del)).filter((d): d is DelegationResponse => d !== null);
        }) || [];

        return {
            delegations,
            next_key: data.pagination?.next_key
        };
    } */

    private buildQuery(fpBtcPkHex: string, network: Network, options?: DelegationQueryOptions) {
        const query: any = {
            finalityProviderBtcPksHex: fpBtcPkHex,
            networkType: network.toLowerCase()
        };

        if (options?.status && options.status !== BTCDelegationStatus.ANY) {
            query.state = options.status;
        }

        if (options?.minAmount || options?.maxAmount) {
            query.totalSat = {};
            if (options.minAmount) {
                query.totalSat.$gte = options.minAmount;
            }
            if (options.maxAmount) {
                query.totalSat.$lte = options.maxAmount;
            }
        }

        return query;
    }

    private getSortOptions(options?: DelegationQueryOptions): { [key: string]: 1 | -1 } {
        if (!options?.sortBy) {
            // Default sort
            return { createdAt: -1 }; 
        }

        const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
        
        switch (options.sortBy) {
            case 'amount':
                return { totalSat: sortOrder };
            case 'startHeight':
                return { startHeight: sortOrder };
            case 'createdAt':
                return { createdAt: sortOrder };
            default:
                return { createdAt: -1 };
        }
    }

    private async getDelegationsFromDatabase(
        fpBtcPkHex: string,
        network: Network,
        page: number = 1,
        limit: number = 10,
        options?: DelegationQueryOptions
    ): Promise<{
        delegations: DelegationResponse[];
        pagination: {
            total_count: number;
            total_pages: number;
            current_page: number;
            has_next: boolean;
            has_previous: boolean;
            next_page: number | null;
            previous_page: number | null;
        };
        total_stats: {
            total_amount: string;
            total_amount_sat: number;
            active_amount: string;
            active_amount_sat: number;
            unbonding_amount: string;
            unbonding_amount_sat: number;
        };
    }> {
        try {
            const skip = (page - 1) * limit;
            const baseQuery = this.buildQuery(fpBtcPkHex, network, options);
            const sort = this.getSortOptions(options);

            // Get all data with a single aggregation pipeline
            const [result] = await NewBTCDelegation.aggregate([
                // First stage: Apply base query
                { $match: baseQuery },

                // Second stage: Get both pagination and stats info with Facet
                {
                    $facet: {
                        // Data required for pagination
                        paginatedResults: [
                            { $sort: sort },
                            { $skip: skip },
                            { $limit: limit }
                        ],
                        // Total record count
                        totalCount: [
                            { $count: 'count' }
                        ],
                        // Statistics
                        stats: [
                            {
                                $group: {
                                    _id: null,
                                    total_amount_sat: { $sum: '$totalSat' },
                                    active_amount_sat: {
                                        $sum: {
                                            $cond: [
                                                { $eq: ['$state', 'ACTIVE'] },
                                                '$totalSat',
                                                0
                                            ]
                                        }
                                    },
                                    unbonding_amount_sat: {
                                        $sum: {
                                            $cond: [
                                                { $eq: ['$state', 'UNBONDED'] },
                                                '$totalSat',
                                                0
                                            ]
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            ]);

            const totalCount = result.totalCount[0]?.count || 0;
            const totalPages = Math.ceil(totalCount / limit);
            const stats = result.stats[0] || {
                total_amount_sat: 0,
                active_amount_sat: 0,
                unbonding_amount_sat: 0
            };

            // Format delegations
            const formattedDelegations: DelegationResponse[] = result.paginatedResults.map((del: DelegationDocument) => ({
                staker_address: del.stakerAddress,
                stakerBtcAddress: del.stakerBtcAddress || '',
                status: del.state,
                btc_pk_hex: del.stakerBtcPkHex,
                amount: formatSatoshis(del.totalSat),
                amount_sat: del.totalSat,
                start_height: del.startHeight,
                end_height: del.endHeight || 0,
                duration: del.stakingTime,
                transaction_id_hex: del.stakingTxIdHex,
                transaction_id: del.stakingTxHex,
                active: del.state === 'ACTIVE',
                unbonding_time: del.unbondingTime,
                unbonding: del.unbondingTxHex ? {
                    transaction_id: del.unbondingTxHex,
                    transaction_id_hex: del.unbondingTxIdHex || '',
                    spend_transaction_id: del.spendStakeTxHex || undefined,
                    spend_transaction_id_hex: del.spendStakeTxIdHex || undefined
                } : undefined,
            }));

            return {
                delegations: formattedDelegations,
                pagination: {
                    total_count: totalCount,
                    total_pages: totalPages,
                    current_page: page,
                    has_next: page < totalPages,
                    has_previous: page > 1,
                    next_page: page < totalPages ? page + 1 : null,
                    previous_page: page > 1 ? page - 1 : null
                },
                total_stats: {
                    total_amount: formatSatoshis(stats.total_amount_sat),
                    total_amount_sat: stats.total_amount_sat,
                    active_amount: formatSatoshis(stats.active_amount_sat),
                    active_amount_sat: stats.active_amount_sat,
                    unbonding_amount: formatSatoshis(stats.unbonding_amount_sat),
                    unbonding_amount_sat: stats.unbonding_amount_sat
                }
            };
        } catch (error) {
            logger.error('Error fetching delegations from database:', error);
            throw error;
        }
    }

    public async getFinalityProviderDelegations(
        fpBtcPkHex: string, 
        network: Network = this.network,
        page: number = 1,
        limit: number = 10,
        options?: DelegationQueryOptions
    ): Promise<{
        delegations: DelegationResponse[];
        pagination: {
            total_count: number;
            total_pages: number;
            current_page: number;
            has_next: boolean;
            has_previous: boolean;
            next_page: number | null;
            previous_page: number | null;
        };
        total_stats: {
            total_amount: string;
            total_amount_sat: number;
            active_amount: string;
            active_amount_sat: number;
            unbonding_amount: string;
            unbonding_amount_sat: number;
        };
    }> {
        return this.getDelegationsFromDatabase(fpBtcPkHex, network, page, limit, options);
    }
} 