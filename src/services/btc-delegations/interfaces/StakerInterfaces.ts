export interface RecentDelegation {
    stakingTxIdHex: string;
    txHash?: string;
    state: string;
    networkType: string;
    totalSat: number;
    stakingTime: number;
}

export interface DelegationDetail {
    stakingTxIdHex: string;
    txHash?: string;
    finalityProviderBtcPkHex: string;
    totalSat: number;
    stakingTime: number;
    unbondingTime: number;
    state: string;
    networkType: string;
    paramsVersion?: number;
    phase: number;
}

export interface FinalityProviderStat {
    btcPkHex: string;
    delegationsCount: number;
    totalStakedSat: number;
}

export interface PhaseStat {
    phase: number;
    totalDelegations: number;
    totalStakedSat: number;
    activeDelegations: number;
    activeStakedSat: number;
    finalityProviders: FinalityProviderStat[];
}

export interface NetworkStats {
    totalDelegations: number;
    activeDelegations: number;
    totalStakedSat: number;
    activeStakedSat: number;
}

export interface DelegationStates {
    PENDING: number;
    VERIFIED: number;
    ACTIVE: number;
    UNBONDED: number;
} 