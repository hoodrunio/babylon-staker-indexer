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
    pop: ProofOfPossessionBTC;
    slashed_babylon_height: number;
    slashed_btc_height: number;
    jailed: boolean;
    highest_voted_height: number;
}

export interface FinalityProviderWithMeta {
    btc_pk: string;
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

export interface BTCDelegation {
    staker_addr: string;
    btc_pk: string;
    pop: ProofOfPossessionBTC;
    fp_btc_pk_list: string[];
    staking_time: number;
    start_height: number;
    end_height: number;
    total_sat: number;
    staking_tx: string;
    staking_output_idx: number;
    slashing_tx?: string;
}

export interface BTCDelegatorDelegationsResponse {
    dels: {
        staker_addr: string;
        btc_pk: string;
        fp_btc_pk_list: string[];
        staking_time: number;
        start_height: number;
        end_height: number;
        total_sat: string;
        staking_tx_hex: string;
        slashing_tx_hex: string;
        delegator_slash_sig_hex: string;
        covenant_sigs: any[];
        staking_output_idx: number;
        active: boolean;
        status_desc: string;
        unbonding_time: number;
        undelegation_response: any;
        params_version: number;
    }[];
}

export interface QueryFinalityProvidersResponse {
    finality_providers: FinalityProvider[];
    pagination?: {
        next_key: string;
        total: number;
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
    /** Provider'ın BTC public key'i (hex formatında) */
    fpBtcPkHex: string;
    
    /** Provider'ın voting power'ı (BTC cinsinden, formatlanmış) */
    power: string;
    
    /** Provider'ın voting power'ı (satoshi cinsinden, raw değer) */
    rawPower?: string;
    
    /** Provider'ın voting power yüzdesi (0-100 arasında, 2 decimal) */
    powerPercentage: string;
    
    /** Power'ın hesaplandığı Babylon yüksekliği */
    height: number;
    
    /** Tüm aktif provider'ların toplam power'ı (BTC cinsinden, formatlanmış) */
    totalPower: string;
    
    /** Tüm aktif provider'ların toplam power'ı (satoshi cinsinden, raw değer) */
    rawTotalPower?: string;
}

export interface DelegationResponse {
    /** Delegator'ın adresi */
    staker_address: string;

    /** Delegasyonun durum açıklaması */
    status: string;

    /** staker'ın BTC public key'i (hex formatında) */
    btc_pk_hex: string;
    
    /** Delegasyon miktarı (BTC cinsinden, formatlanmış) */
    amount: string;
    
    /** Delegasyon miktarı (satoshi cinsinden) */
    amount_sat: number;
    
    /** Delegasyonun başlangıç bloğu */
    start_height: number;
    
    /** Delegasyonun bitiş bloğu */
    end_height: number;
    
    /** Delegasyonun süresi (blok sayısı) */
    duration: number;
    
    /** Delegasyonun işlem hash'i */
    transaction_id: string;

    /** Delegasyonun işlem hash'inin hex formatı */
    transaction_id_hex: string;
} 