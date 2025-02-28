/**
 * BBN Transaction type enumeration
 */
export enum BBNTransactionType {
    TRANSFER = 'TRANSFER',
    STAKE = 'STAKE',
    UNSTAKE = 'UNSTAKE',
    REWARD = 'REWARD',
    OTHER = 'OTHER'
}

/**
 * BBN Transaction status enumeration
 */
export enum BBNTransactionStatus {
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED'
}

/**
 * BBN Stake status enumeration
 */
export enum BBNStakeStatus {
    ACTIVE = 'ACTIVE',
    UNBONDING = 'UNBONDING',
    UNBONDED = 'UNBONDED'
}

/**
 * Period type for statistics
 */
export enum StatPeriodType {
    DAILY = 'DAILY',
    WEEKLY = 'WEEKLY',
    MONTHLY = 'MONTHLY',
    ALL_TIME = 'ALL_TIME'
}

/**
 * BBN Transaction interface
 */
export interface BBNTransactionData {
    txHash: string;
    sender: string;
    receiver: string;
    amount: number;
    denom: string;
    type: BBNTransactionType;
    blockHeight: number;
    timestamp: number;
    status: BBNTransactionStatus;
    fee: number;
    memo?: string;
    networkType: 'mainnet' | 'testnet';
}

/**
 * BBN Stake interface
 */
export interface BBNStakeData {
    txHash: string;
    stakerAddress: string;
    validatorAddress: string;
    amount: number;
    denom: string;
    startHeight: number;
    startTimestamp: number;
    unbondingTime?: number;
    endTimestamp?: number;
    status: BBNStakeStatus;
    networkType: 'mainnet' | 'testnet';
    unbondingTxHash?: string;
} 