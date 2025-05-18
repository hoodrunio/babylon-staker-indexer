import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';
import { formatSatoshis } from '../../utils/util';
import { logger } from '../../utils/logger';
import { NewBTCDelegation } from '../../database/models/NewBTCDelegation';

export interface StakerResponse {
    /** Staker's address */
    staker_address: string;

    /** Total delegation amount (in BTC, formatted) */
    total_amount: string;
    
    /** Total delegation amount (in satoshi) */
    total_amount_sat: number;
    
    /** Count of delegations to finality providers */
    delegation_count: number;
}

export class FinalityStakerService {
    private static instance: FinalityStakerService | null = null;
    private babylonClient: BabylonClient;
    private network: Network;

    private constructor() {
        this.babylonClient = BabylonClient.getInstance();
        this.network = this.babylonClient.getNetwork();
    }

    public static getInstance(): FinalityStakerService {
        if (!FinalityStakerService.instance) {
            FinalityStakerService.instance = new FinalityStakerService();
        }
        return FinalityStakerService.instance;
    }

    /**
     * Get stakers for a finality provider from the database
     * @param fpBtcPkHex BTC public key of the finality provider (in hex format)
     * @param network Network to query (mainnet or testnet)
     * @returns Array of staker responses
     */
    public async getStakersByFinalityProvider(
        fpBtcPkHex: string,
        network: Network
    ): Promise<StakerResponse[]> {
        try {
            // Find all active delegations for this finality provider
            const activeStates = ['ACTIVE'];
            
            // MongoDB aggregation pipeline to group by staker address and calculate totals
            const stakers = await NewBTCDelegation.aggregate([
                {
                    $match: {
                        finalityProviderBtcPksHex: fpBtcPkHex,
                        networkType: network.toLowerCase(),
                        state: { $in: activeStates }
                    }
                },
                {
                    $group: {
                        _id: "$stakerAddress",
                        total_amount_sat: { $sum: "$totalSat" },
                        delegation_count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        staker_address: "$_id",
                        total_amount_sat: 1,
                        delegation_count: 1
                    }
                },
                { $sort: { total_amount_sat: -1 } }
            ]);
            
            // Format amounts
            return stakers.map(staker => ({
                staker_address: staker.staker_address,
                total_amount: formatSatoshis(staker.total_amount_sat),
                total_amount_sat: staker.total_amount_sat,
                delegation_count: staker.delegation_count
            }));
        } catch (error) {
            logger.error(`Error getting stakers for FP ${fpBtcPkHex}:`, error);
            throw error;
        }
    }

    /**
     * Get all stakers from the database
     * @param network Network to query (mainnet or testnet)
     * @returns Array of staker responses
     */
    public async getAllStakers(
        network: Network
    ): Promise<StakerResponse[]> {
        try {
            // Find all active delegations across all finality providers
            const activeStates = ['ACTIVE'];
            
            // MongoDB aggregation pipeline to group by staker address and calculate totals
            const stakers = await NewBTCDelegation.aggregate([
                {
                    $match: {
                        networkType: network.toLowerCase(),
                        state: { $in: activeStates }
                    }
                },
                {
                    $group: {
                        _id: "$stakerAddress",
                        total_amount_sat: { $sum: "$totalSat" },
                        delegation_count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        staker_address: "$_id",
                        total_amount_sat: 1,
                        delegation_count: 1
                    }
                },
                { $sort: { total_amount_sat: -1 } }
            ]);
            
            // Format amounts
            return stakers.map(staker => ({
                staker_address: staker.staker_address,
                total_amount: formatSatoshis(staker.total_amount_sat),
                total_amount_sat: staker.total_amount_sat,
                delegation_count: staker.delegation_count
            }));
        } catch (error) {
            logger.error(`Error getting all stakers:`, error);
            throw error;
        }
    }
}