import { Request } from 'express';

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: 'asc' | 'desc';
  skip?: number;
}

declare global {
  namespace Express {
    interface Request {
      pagination?: PaginationQuery;
    }
  }
}

export interface TimeRange {
  firstTimestamp: number;
  lastTimestamp: number;
  durationSeconds: number;
}

export interface StakeMetrics {
  totalStakeBTC: number;
  transactionCount: number;
  uniqueStakers?: number;
  uniqueBlocks: number;
  timeRange: TimeRange;
}

export interface PhaseStakeInfo {
  phase: number;
  totalStake: number;
  transactionCount: number;
}

export interface FinalityProviderPhaseStake extends PhaseStakeInfo {
  stakerCount: number;
  stakers: Array<{
    address: string;
    stake: number;
  }>;
}

export interface StakerPhaseStake extends PhaseStakeInfo {
  finalityProviders: Array<{
    address: string;
    stake: number;
  }>;
}

export interface FinalityProviderStats {
  address: string;
  totalStake: string;
  createdAt: number;
  updatedAt: number;
  totalStakeBTC: number;
  transactionCount: number;
  uniqueStakers: number;
  uniqueBlocks: number;
  timeRange: {
    firstTimestamp: number;
    lastTimestamp: number;
    durationSeconds: number;
  };
  averageStakeBTC: number;
  versionsUsed: number[];
  stakerAddresses?: string[];
  stats: Record<string, any>;
  phaseStakes: {
    phase: number;
    totalStake: number;
    transactionCount: number;
    stakerCount: number;
    stakers?: {
      address: string;
      stake: number;
      timestamp?: number;
      txId?: string;
    }[];
  }[];
}

export interface TransactionInfo {
  txid: string;
  timestamp: number;
  amount: number;
  amountBTC: number;
  finalityProvider: string;
}

export interface StakerStats {
  address: string;
  stakerPublicKey?: string;
  totalStake: string;
  totalStakeBTC: number;
  transactionCount: number;
  uniqueProviders: number;
  uniqueBlocks: number;
  timeRange: {
    firstTimestamp: number;
    lastTimestamp: number;
    durationSeconds: number;
  };
  averageStakeBTC: number;
  versionsUsed: number[];
  finalityProviders: string[];
  activeStakes: number;
  stats: Record<string, any>;
  phaseStakes: {
    phase: number;
    totalStake: number;
    transactionCount: number;
    finalityProviders: Array<{
      address: string;
      stake: number;
    }>;
  }[];
  transactions?: TransactionInfo[];
}

export interface TopFinalityProviderStats extends FinalityProviderStats {
  rank: number;
  stakingShare: number;
}

export interface StakeTransaction {
  txid: string;
  blockHeight: number;
  timestamp: number;
  stakeAmount: number;
  stakerAddress: string;
  stakerPublicKey: string;
  finalityProvider: string;
  stakingTime: number;
  version: number;
  paramsVersion: number;
  isOverflow: boolean;
  overflowAmount: number;
  phase?: number;
}

export interface VersionStats extends StakeMetrics {
  uniqueFPs: number;
}

export interface FinalityProvider {
  address: string;
  totalStake: string;
  createdAt: number;
  updatedAt: number;
}

export interface FinalityProviderStake {
  address: string;
  stake: number;
}

export interface PhaseStake {
  phase: number;
  totalStake: number;
  transactionCount: number;
  finalityProviders: FinalityProviderStake[];
}

export interface StakerDocument {
  address: string;
  stakerPublicKey?: string;
  totalStake: number;
  transactionCount: number;
  activeStakes: number;
  uniqueProviders: string[];
  versionsUsed: number[];
  firstSeen: number;
  lastSeen: number;
  phaseStakes: Array<{
    phase: number;
    totalStake: number;
    transactionCount: number;
    finalityProviders: Array<{
      address: string;
      stake: number;
    }>;
  }>;
  transactions?: Array<{
    txid: string;
    phase: number;
    timestamp: number;
    amount: number;
    finalityProvider: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}