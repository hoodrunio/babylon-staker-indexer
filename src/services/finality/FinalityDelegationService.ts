import { Network } from '../../api/middleware/network-selector';
import { BabylonClient } from '../../clients/BabylonClient';
import { 
    QueryFinalityProviderDelegationsResponse,
    DelegationResponse,
    BTCDelegation
} from '../../types/finality/btcstaking';
import { formatSatoshis } from '../../utils/util';
import { getTxHash } from '../../utils/generate-tx-hash';
import { FinalityDelegationCacheManager } from './FinalityDelegationCacheManager';

export class FinalityDelegationService {
    private static instance: FinalityDelegationService | null = null;
    private babylonClient: BabylonClient;
    private cacheManager: FinalityDelegationCacheManager;

    private constructor() {
        if (!process.env.BABYLON_NODE_URL || !process.env.BABYLON_RPC_URL) {
            throw new Error('BABYLON_NODE_URL and BABYLON_RPC_URL environment variables must be set');
        }
        this.babylonClient = BabylonClient.getInstance(
            process.env.BABYLON_NODE_URL,
            process.env.BABYLON_RPC_URL
        );
        this.cacheManager = FinalityDelegationCacheManager.getInstance();
    }

    public static getInstance(): FinalityDelegationService {
        if (!FinalityDelegationService.instance) {
            FinalityDelegationService.instance = new FinalityDelegationService();
        }
        return FinalityDelegationService.instance;
    }

    private getNetworkConfig(network: Network = Network.MAINNET) {
        return {
            nodeUrl: network === Network.MAINNET ? process.env.BABYLON_NODE_URL : process.env.BABYLON_TESTNET_NODE_URL,
            rpcUrl: network === Network.MAINNET ? process.env.BABYLON_RPC_URL : process.env.BABYLON_TESTNET_RPC_URL
        };
    }

    private processDelegation(del: BTCDelegation): DelegationResponse | null {
        if (!del) return null;

        const totalSat = Number(del.total_sat);
        if (isNaN(totalSat)) {
            console.warn(`Invalid total_sat value for delegation:`, del);
            return null;
        }

        const response: DelegationResponse = {
            staker_address: del.staker_addr || '',
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

        // Unbonding bilgilerini ekle
        if (del.undelegation_response) {
            response.unbonding = {
                transaction_id: del.undelegation_response.unbonding_tx_hex,
                transaction_id_hex: getTxHash(del.undelegation_response.unbonding_tx_hex || '', false),
                spend_transaction_id: del.undelegation_response.delegator_unbonding_info?.spend_stake_tx_hex
            };
        }

        return response;
    }

    private async fetchDelegations(
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
    }

    public async getFinalityProviderDelegations(
        fpBtcPkHex: string, 
        network: Network = Network.MAINNET,
        page: number = 1,
        limit: number = 10
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
        return this.cacheManager.getDelegations(
            fpBtcPkHex,
            network,
            page,
            limit,
            this.fetchDelegations.bind(this)
        );
    }
} 