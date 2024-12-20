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
}

export interface TimeRange {
  firstTimestamp: number;
  lastTimestamp: number;
  durationSeconds: number;
}

export interface StakeMetrics {
  totalStakeBTC: number;
  transactionCount: number;
  uniqueStakers: number;
  uniqueBlocks: number;
  timeRange: TimeRange;
}

export interface FinalityProviderStats extends StakeMetrics {
  address: string;
  averageStakeBTC: number;
  versionsUsed: number[];
  stakerAddresses: string[];
}

export interface StakerStats extends StakeMetrics {
  finalityProviders: string[];
  activeStakes: number;
  totalRewards?: number;
}

export interface VersionStats extends StakeMetrics {
  uniqueFPs: number;
}

export interface TopFinalityProviderStats extends FinalityProviderStats {
  rank?: number;
  stakingShare?: number; // Total stake'in yüzdesi
}