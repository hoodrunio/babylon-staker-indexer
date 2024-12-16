export interface DatabaseSchema {
  transactions: {
    txid: string;
    block_height: number;
    timestamp: number;
    stake_amount: number;
    staker_address: string;
    staker_public_key: string;
    finality_provider: string;
    staking_time: number;
    version: number;
    params_version: number;
  };

  finality_providers: {
    address: string;
    total_stake: number;
    transaction_count: number;
    unique_stakers: string[];
    first_seen: number;
    last_seen: number;
    versions_used: number[];
  };

  stakers: {
    address: string;
    total_stake: number;
    transaction_count: number;
    finality_providers: string[];
    first_seen: number;
    last_seen: number;
    active_stakes: number;
  };
} 