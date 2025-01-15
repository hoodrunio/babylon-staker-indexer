import { Network } from '../../api/middleware/network-selector';

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
    endHeight?: number;
    timestamp: number;
    providerStats?: ProviderEpochStats[];
}

export interface FinalityProvider {
    fpBtcPkHex: string;
    power: string;
    height: number;
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