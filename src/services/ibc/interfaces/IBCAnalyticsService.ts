import { Network } from '../../../types/finality';

/**
 * Interface for analytics data providers following ISP principle
 */
export interface IChannelAnalyticsProvider {
    getChannelStats(network: Network): Promise<ChannelStatsResult>;
    getChannelVolumes(network: Network): Promise<ChannelVolumeResult[]>;
    getActiveChannelsCount(network: Network): Promise<number>;
}

export interface IChainAnalyticsProvider {
    getConnectedChains(network: Network): Promise<ChainInfoResult[]>;
    getChainVolumes(network: Network): Promise<ChainVolumeResult[]>;
    getChainTransactionCounts(network: Network): Promise<ChainTransactionCountResult[]>;
}

export interface ITransactionAnalyticsProvider {
    getTotalTransactionCount(network: Network): Promise<TransactionCountResult>;
    getLatestTransactions(limit: number, network: Network): Promise<TransactionResult[]>;
    getTransactionCountsByChain(network: Network): Promise<ChainTransactionCountResult[]>;
}

export interface IRelayerAnalyticsProvider {
    getRelayersByChain(network: Network): Promise<RelayerByChainResult[]>;
    getRelayerVolumes(network: Network): Promise<RelayerVolumeResult[]>;
    getRelayerTransactionCounts(network: Network): Promise<RelayerTransactionCountResult[]>;
}

/**
 * Main analytics service interface following SRP principle
 */
export interface IBCAnalyticsService {
    getChannelAnalytics(network: Network): Promise<ChannelAnalyticsResult>;
    getChainAnalytics(network: Network): Promise<ChainAnalyticsResult>;
    getTransactionAnalytics(network: Network): Promise<TransactionAnalyticsResult>;
    getRelayerAnalytics(network: Network): Promise<RelayerAnalyticsResult>;
    getOverallAnalytics(network: Network): Promise<OverallAnalyticsResult>;
}

/**
 * Data Transfer Objects (DTOs)
 */
export interface ChannelStatsResult {
    total_channels: number;
    active_channels: number;
    channels_by_state: Record<string, number>;
}

export interface ChannelVolumeResult {
    channel_id: string;
    port_id: string;
    counterparty_chain_id: string;
    counterparty_chain_name: string;
    total_volume_usd: string;
    volumes_by_denom: Record<string, string>;
    packet_count: number;
    success_rate: number;
}

export interface ChainInfoResult {
    chain_id: string;
    chain_name: string;
    connection_count: number;
    channel_count: number;
    first_connected: Date;
    last_activity: Date;
}

export interface ChainVolumeResult {
    chain_id: string;
    chain_name: string;
    total_volume_usd: string;
    volumes_by_denom: Record<string, string>;
    incoming_volume: string;
    outgoing_volume: string;
}

export interface TransactionCountResult {
    total_transactions: number;
    successful_transactions: number;
    failed_transactions: number;
    success_rate: number;
}

export interface TransactionResult {
    tx_hash: string;
    source_chain_id: string;
    destination_chain_id: string;
    amount: string;
    denom: string;
    sender: string;
    receiver: string;
    timestamp: Date;
    success: boolean;
    completion_time_ms?: number;
}

export interface ChainTransactionCountResult {
    chain_id: string;
    chain_name: string;
    total_transactions: number;
    successful_transactions: number;
    failed_transactions: number;
    success_rate: number;
}

export interface RelayerByChainResult {
    chain_id: string;
    chain_name: string;
    relayer_addresses: string[];
    active_relayer_count: number;
}

export interface RelayerVolumeResult {
    relayer_address: string;
    total_volume_usd: string;
    volumes_by_chain: Record<string, string>;
    total_packets_relayed: number;
    success_rate: number;
}

export interface RelayerTransactionCountResult {
    relayer_address: string;
    chain_id?: string;
    chain_name?: string;
    total_transactions: number;
    successful_transactions: number;
    failed_transactions: number;
    success_rate: number;
    avg_completion_time_ms: number;
}

/**
 * Aggregated analytics results
 */
export interface ChannelAnalyticsResult {
    stats: ChannelStatsResult;
    volumes: ChannelVolumeResult[];
    top_channels_by_volume: ChannelVolumeResult[];
    top_channels_by_activity: ChannelVolumeResult[];
}

export interface ChainAnalyticsResult {
    connected_chains: ChainInfoResult[];
    volumes: ChainVolumeResult[];
    transaction_counts: ChainTransactionCountResult[];
}

export interface TransactionAnalyticsResult {
    overall_stats: TransactionCountResult;
    by_chain: ChainTransactionCountResult[];
    latest_transactions: TransactionResult[];
}

export interface RelayerAnalyticsResult {
    by_chain: RelayerByChainResult[];
    volumes: RelayerVolumeResult[];
    transaction_counts: RelayerTransactionCountResult[];
    top_relayers: RelayerVolumeResult[];
}

export interface OverallAnalyticsResult {
    channels: ChannelAnalyticsResult;
    chains: ChainAnalyticsResult;
    transactions: TransactionAnalyticsResult;
    relayers: RelayerAnalyticsResult;
} 