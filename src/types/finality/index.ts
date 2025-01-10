export interface BlockSignatureInfo {
    height: number;
    signed: boolean;
    timestamp: Date;
    epochNumber: number;  // Epoch bilgisini de ekleyelim
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
    epochStats: { [epochNumber: number]: any };
    lastSignedBlock?: BlockSignatureInfo;
}

export interface SignatureStatsParams {
    fpBtcPkHex: string;
    startHeight?: number;
    endHeight?: number;
    lastNBlocks?: number;
} 