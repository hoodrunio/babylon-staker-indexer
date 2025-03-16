export interface Description {
    moniker?: string;
    identity?: string;
    website?: string;
    details?: string;
    security_contact?: string;
}

export interface FinalityProvider {
    addr: string;
    description: Description;
    commission: string;
    btc_pk: string;
    // pop?: ProofOfPossessionBTC;
    slashed_babylon_height: number;
    slashed_btc_height: number;
    jailed: boolean;
    highest_voted_height: number;
}

export interface FinalityProviderWithMeta {
    btc_pk: string;
    btc_pk_hex?: string;
    height: number;
    voting_power: number;
    slashed_babylon_height: number;
    slashed_btc_height: number;
    jailed: boolean;
    highest_voted_height: number;
}

export interface ProofOfPossessionBTC {
    btc_sig: string;
    babylon_sig: string;
}

export interface SignatureInfo {
    signature_hex: string;
    pubkey_hex: string;
}

export interface CovenantAdaptorSignatures {
    adaptor_signature_hex: string;
    pubkey_hex: string;
}

export interface BTCUndelegationResponse {
    unbonding_tx_hex: string;
    spend_stake_tx_hex?: string;
    covenant_unbonding_sig_list: SignatureInfo[];
    slashing_tx_hex: string;
    delegator_slashing_sig_hex: string;
    covenant_slashing_sigs: CovenantAdaptorSignatures[];
    delegator_unbonding_info: {
        spend_stake_tx_hex: string;
    };
}

export interface BTCDelegation {
    staker_addr: string;
    stakerBtcAddress?: string;
    btc_pk: string;
    fp_btc_pk_list: string[];
    staking_time: number;
    start_height: number;
    end_height: number;
    total_sat: number;
    staking_tx_hex: string;
    slashing_tx_hex: string;
    transaction_id_hex?: string;
    delegator_slash_sig_hex: string;
    covenant_sigs: CovenantAdaptorSignatures[];
    staking_output_idx: number;
    active: boolean;
    status_desc: string;
    unbonding_time: number;
    undelegation_response: BTCUndelegationResponse | null;
    params_version: number;
}

export interface BTCDelegatorDelegationsResponse {
    dels: BTCDelegation[];
}

export interface QueryFinalityProvidersResponse {
    finality_providers: FinalityProvider[];
    pagination?: {
        next_key: string;
        total: number;
    };
}

export interface ActiveProviderResponse {
    finality_providers: FinalityProviderWithMeta[];
    pagination: {
        next_key: string | null;
        total: string;
    };
} 

export interface QueryFinalityProviderResponse {
    finality_provider: FinalityProvider;
}

export interface QueryFinalityProviderDelegationsResponse {
    btc_delegator_delegations: BTCDelegatorDelegationsResponse[];
    pagination?: {
        next_key: string;
        total: number;
    };
}

export interface FinalityProviderPower {
    /** Provider's BTC public key (in hex format) */
    fpBtcPkHex?: string;
    
    /** Provider's voting power (in BTC, formatted) */
    power: string;
    
    /** Provider's voting power (in satoshi, raw value) */
    rawPower?: string;
    
    /** Provider's voting power percentage (between 0-100, 2 decimals) */
    powerPercentage: string;
    
    /** Babylon height at which the power was calculated */
    height: number;
    
    /** Total power of all active providers (in BTC, formatted) */
    totalNetworkPower: string;
    
    /** Total power of all active providers (in satoshi, raw value) */
    rawTotalNetworkPower?: string;
}

export interface DelegationResponse {
    /** Delegator's address */
    staker_address: string;

    /** Delegator's BTC address */
    stakerBtcAddress?: string;

    /** Delegation status description */
    status: string;

    /** Staker's BTC public key (in hex format) */
    btc_pk_hex: string;
    
    /** Delegation amount (in BTC, formatted) */
    amount: string;
    
    /** Delegation amount (in satoshi) */
    amount_sat: number;
    
    /** Delegation start block */
    start_height: number;
    
    /** Delegation end block */
    end_height: number;
    
    /** Delegation duration (in blocks) */
    duration: number;
    
    /** Delegation transaction hash */
    transaction_id: string;

    /** Delegation transaction hash in hex format */
    transaction_id_hex: string;

    /** Whether the delegation is active */
    active: boolean;

    /** Unbonding duration (in blocks) */
    unbonding_time: number;

    /** Unbonding transaction information */
    unbonding?: {
        /** Unbonding transaction hash */
        transaction_id: string;
        /** Unbonding transaction hash in hex format */
        transaction_id_hex: string;
        /** Transaction hash where the unbonding transaction was spent */
        spend_transaction_id?: string;
        /** Hex format of the transaction hash where the unbonding transaction was spent */
        spend_transaction_id_hex?: string;
    };

    /** BTC public keys of finality providers (in hex format) */
    finality_provider_btc_pks_hex?: string[];

    /** Params version */
    params_version?: number;
}

export enum BTCDelegationStatus {
    PENDING = 'PENDING',
    VERIFIED = 'VERIFIED',
    ACTIVE = 'ACTIVE',
    UNBONDED = 'UNBONDED',
    EXPIRED = 'EXPIRED',
    ANY = 'ANY'
}