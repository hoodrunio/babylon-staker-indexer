export enum Network {
    MAINNET = 'mainnet',
    TESTNET = 'testnet'
}
export interface FinalityParams {
    max_active_finality_providers: number;
    signed_blocks_window: string;
    finality_sig_timeout: string;
    min_signed_per_window: string;
    min_pub_rand: string;
    jail_duration: string;
    finality_activation_height: string;
}

export interface Vote {
    fp_btc_pk_hex: string;
    signature: string;
    timestamp: string;
}

export interface CurrentEpochResponse {
    current_epoch: number;
    epoch_boundary: number;
}

export interface SignatureStatsParams {
    fpBtcPkHex: string;
    startHeight?: number;
    endHeight?: number;
    lastNBlocks?: number;
    network?: Network;
}

export interface SignatureStats {
    fp_btc_pk_hex: string;
    startHeight: number;
    endHeight: number;
    currentHeight: number;
    totalBlocks: number;
    signedBlocks: number;
    missedBlocks: number;
    unknownBlocks: number;
    signatureRate: number;
    missedBlockHeights: number[];
    signatureHistory: BlockSignatureInfo[];
    epochStats: { [key: number]: EpochStats };
    lastSignedBlock?: BlockSignatureInfo;
}

export interface BlockSignatureInfo {
    height: number;
    timestamp: Date;
    signed: boolean;
    status: 'signed' | 'missed' | 'unknown';
    epochNumber: number;
}

export interface EpochInfo {
    epochNumber: number;
    startHeight: number;
    endHeight: number;
}

export interface ProviderEpochStats {
    btcPk: string;
    signedBlocks: number;
    missedBlocks: number;
    successRate: number;
}

export interface EpochStats {
    epochNumber: number;
    startHeight: number;
    currentHeight: number;
    endHeight: number;
    providerStats: {
        btcPk: string;
        signedBlocks: number;
        missedBlocks: number;
        successRate: number;
        votingPower: string;
    }[];
    timestamp: number;
}

export interface FinalityProvider {
    fpBtcPkHex: string;
    height: number;
    votingPower: string;
    slashedBabylonHeight: string;
    slashedBtcHeight: number;
    jailed: boolean;
    highestVotedHeight: number;
    description?: {
        moniker?: string;
        identity?: string;
        website?: string;
        details?: string;
    };
}

export interface FinalityProviderPower {
    fpBtcPkHex: string;
    power: string;
    height: number;
} 