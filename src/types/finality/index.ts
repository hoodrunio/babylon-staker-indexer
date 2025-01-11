export interface BlockSignatureInfo {
    height: number;
    signed: boolean;
    timestamp: Date;
    epochNumber: number;
    status: 'signed' | 'missed' | 'unknown';
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
    epochStats: { 
        [epochNumber: number]: {
            totalBlocks: number;
            signedBlocks: number;
            missedBlocks: number;
            unknownBlocks: number;
            signatureRate: number;
            startHeight: number;
            endHeight: number;
        } 
    };
    lastSignedBlock?: BlockSignatureInfo;
}

export interface SignatureStatsParams {
    fpBtcPkHex: string;
    startHeight?: number;
    endHeight?: number;
    lastNBlocks?: number;
}

export interface EpochInfo {
    epochNumber: number;
    startHeight: number;
    endHeight: number;
} 