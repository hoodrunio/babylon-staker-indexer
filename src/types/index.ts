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

export interface FinalityProviderStats extends StakeMetrics {
  address: string;
  averageStakeBTC: number;
  versionsUsed: number[];
  stakerAddresses: string[];
  phaseStakes?: FinalityProviderPhaseStake[];
}

export interface StakeTransactionInfo {
  txid: string;
  timestamp: number;
  amount: number;
  amountBTC: number;
  finalityProvider: string;
}

export interface PhaseTransactions {
  phase: number;
  transactions: StakeTransactionInfo[];
}

export interface StakerStats extends StakeMetrics {
  address: string;
  finalityProviders: string[];
  activeStakes: number;
  totalRewards?: number;
  phaseStakes?: StakerPhaseStake[];
  transactions?: PhaseTransactions[];
}

export interface TopFinalityProviderStats extends FinalityProviderStats {
  rank?: number;
  stakingShare?: number; // Total stake'in yüzdesi
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