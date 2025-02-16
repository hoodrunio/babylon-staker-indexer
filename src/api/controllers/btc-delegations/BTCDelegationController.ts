import { Request, Response } from 'express';
import { Network } from '../../../types/finality';
import { NewBTCDelegation } from '../../../database/models/NewBTCDelegation';
import { formatSatoshis } from '../../../utils/util';
import { BTCDelegationStatus } from '../../../types/finality/btcstaking';
import { logger } from '../../../utils/logger';
interface DelegationQuery {
    stakerAddress: string;
    networkType: string;
    state?: BTCDelegationStatus;
}

export class BTCDelegationController {
    public static async getDelegationsByStatus(req: Request, res: Response) {
        try {
            const status = (req.query.status as string || 'ACTIVE').toUpperCase();
            const network = req.network || Network.MAINNET;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const skip = (page - 1) * limit;

            // Status kontrolü
            if (!Object.values(BTCDelegationStatus).includes(status as BTCDelegationStatus)) {
                logger.error(`Invalid status: ${status}`);
                return res.status(400).json({
                    error: `Invalid status. Must be one of: ${Object.values(BTCDelegationStatus).join(', ')}`
                });
            }

            logger.info(`Fetching delegations with status: ${status}, network: ${network}, page: ${page}, limit: ${limit}`);

            // ANY durumu için özel kontrol
            const stateQuery = status === 'ANY' 
                ? {} 
                : { state: status };

            const baseQuery = {
                ...stateQuery,
                networkType: network.toLowerCase()
            };

            const [delegations, total, allDelegations] = await Promise.all([
                NewBTCDelegation.find(baseQuery)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit),
                NewBTCDelegation.countDocuments(baseQuery),
                NewBTCDelegation.find(baseQuery).select('totalSat')
            ]);

            logger.info(`Found ${delegations.length} delegations out of ${total} total`);

            // Calculate total amount from all delegations
            const totalAmountSat = allDelegations.reduce((sum, d) => sum + d.totalSat, 0);

            const formattedDelegations = delegations.map(d => ({
                staker_address: d.stakerAddress,
                status: d.state,
                btc_pk_hex: d.stakerBtcPkHex,
                finality_provider_btc_pks: d.finalityProviderBtcPksHex || [],
                amount: formatSatoshis(d.totalSat),
                amount_sat: d.totalSat,
                start_height: d.startHeight,
                end_height: d.endHeight || 0,
                duration: d.stakingTime,
                transaction_id_hex: d.stakingTxIdHex,
                transaction_id: d.stakingTxHex,
                active: d.state === 'ACTIVE',
                unbonding_time: d.unbondingTime,
                unbonding: d.unbondingTxHex ? {
                    transaction_id: d.unbondingTxHex,
                    transaction_id_hex: d.unbondingTxIdHex,
                    spend_transaction_id: d.spendStakeTxHex
                } : undefined
            }));

            const totalPages = Math.ceil(total / limit);

            const response = {
                delegations: formattedDelegations,
                pagination: {
                    total_count: total,
                    total_pages: totalPages,
                    current_page: page,
                    has_next: page < totalPages,
                    has_previous: page > 1,
                    next_page: page < totalPages ? page + 1 : null,
                    previous_page: page > 1 ? page - 1 : null
                },
                total_stats: {
                    total_amount: formatSatoshis(totalAmountSat),
                    total_amount_sat: totalAmountSat
                }
            };

            logger.info(`Returning response with ${formattedDelegations.length} delegations`);
            res.json(response);
        } catch (error) {
            logger.error('Error in getDelegationsByStatus:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public static async getDelegationByTxHash(req: Request, res: Response) {
        try {
            const { txHash } = req.params;
            const network = req.network || Network.MAINNET;

            const delegation = await NewBTCDelegation.findOne({
                stakingTxIdHex: txHash,
                networkType: network.toLowerCase()
            });

            if (!delegation) {
                return res.status(404).json({ error: 'Delegation not found' });
            }

            const response = {
                staker_address: delegation.stakerAddress,
                status: delegation.state,
                btc_pk_hex: delegation.stakerBtcPkHex,
                finality_provider_btc_pks: delegation.finalityProviderBtcPksHex || [],
                amount: formatSatoshis(delegation.totalSat),
                amount_sat: delegation.totalSat,
                start_height: delegation.startHeight,
                end_height: delegation.endHeight || 0,
                duration: delegation.stakingTime,
                transaction_id_hex: delegation.stakingTxIdHex,
                transaction_id: delegation.stakingTxHex,
                active: delegation.state === 'ACTIVE',
                unbonding_time: delegation.unbondingTime,
                unbonding: delegation.unbondingTxHex ? {
                    transaction_id: delegation.unbondingTxHex,
                    transaction_id_hex: delegation.unbondingTxIdHex,
                    spend_transaction_id: delegation.spendStakeTxHex
                } : undefined
            };

            res.json(response);
        } catch (error) {
            logger.error('Error in getDelegationByTxHash:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public static async getDelegationsByStakerAddress(req: Request, res: Response) {
        try {
            const { stakerAddress } = req.params;
            const network = req.network || Network.MAINNET;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const skip = (page - 1) * limit;
            const status = (req.query.status as string || 'ANY').toUpperCase();

            // Status kontrolü
            if (status !== 'ANY' && !Object.values(BTCDelegationStatus).includes(status as BTCDelegationStatus)) {
                logger.error(`Invalid status: ${status}`);
                return res.status(400).json({
                    error: `Invalid status. Must be one of: ${Object.values(BTCDelegationStatus).join(', ')}, ANY`
                });
            }

            logger.info(`Fetching delegations for staker: ${stakerAddress}, network: ${network}, page: ${page}, limit: ${limit}, status: ${status}`);

            const baseQuery: DelegationQuery = {
                stakerAddress,
                networkType: network.toLowerCase()
            };

            // ANY durumu için özel kontrol
            if (status !== 'ANY') {
                baseQuery.state = status as BTCDelegationStatus;
            }

            const [delegations, total, allDelegations] = await Promise.all([
                NewBTCDelegation.find(baseQuery)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit),
                NewBTCDelegation.countDocuments(baseQuery),
                NewBTCDelegation.find(baseQuery).select('totalSat')
            ]);

            logger.info(`Found ${delegations.length} delegations out of ${total} total for staker ${stakerAddress}`);

            // Calculate total amount from all delegations
            const totalAmountSat = allDelegations.reduce((sum, d) => sum + d.totalSat, 0);

            const formattedDelegations = delegations.map(d => ({
                staker_address: d.stakerAddress,
                status: d.state,
                btc_pk_hex: d.stakerBtcPkHex,
                finality_provider_btc_pks: d.finalityProviderBtcPksHex || [],
                amount: formatSatoshis(d.totalSat),
                amount_sat: d.totalSat,
                start_height: d.startHeight,
                end_height: d.endHeight || 0,
                duration: d.stakingTime,
                transaction_id_hex: d.stakingTxIdHex,
                transaction_id: d.stakingTxHex,
                active: d.state === 'ACTIVE',
                unbonding_time: d.unbondingTime,
                unbonding: d.unbondingTxHex ? {
                    transaction_id: d.unbondingTxHex,
                    transaction_id_hex: d.unbondingTxIdHex,
                    spend_transaction_id: d.spendStakeTxHex
                } : undefined
            }));

            const totalPages = Math.ceil(total / limit);

            return res.json({
                delegations: formattedDelegations,
                pagination: {
                    total_count: total,
                    total_pages: totalPages,
                    current_page: page,
                    has_next: page < totalPages,
                    has_previous: page > 1,
                    next_page: page < totalPages ? page + 1 : null,
                    previous_page: page > 1 ? page - 1 : null
                },
                total_stats: {
                    total_amount: formatSatoshis(totalAmountSat),
                    total_amount_sat: totalAmountSat
                }
            });
        } catch (error) {
            logger.error('Error in getDelegationsByStakerAddress:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }
} 