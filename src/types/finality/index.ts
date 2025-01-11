export interface BlockSignatureInfo {
    height: number;
    signed: boolean;
    timestamp: Date;
    epochNumber: number;
}

export interface SignatureStats {
    fp_btc_pk_hex: string;
    startHeight: number;
    endHeight: number;
    currentHeight: number;
    totalBlocks: number;
    signedBlocks: number;
    missedBlocks: number;
    signatureRate: number;
    missedBlockHeights: number[];
    signatureHistory: BlockSignatureInfo[];
    epochStats: { 
        [epochNumber: number]: {
            totalBlocks: number;
            signedBlocks: number;
            missedBlocks: number;
            signatureRate: number;
            firstBlockHeight: number;
            epochInterval: number;
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
    interval: number;
} 