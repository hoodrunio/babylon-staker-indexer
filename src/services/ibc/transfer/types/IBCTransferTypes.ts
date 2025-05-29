/**
 * Represents an IBC event with attributes
 */
export interface IBCEvent {
    type: string;
    attributes: Array<{
        key: string;
        value: string;
    }>;
}

/**
 * Status of an IBC transfer
 */
export enum IBCTransferStatus {
    PENDING = 'PENDING',
    RECEIVED = 'RECEIVED',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    TIMEOUT = 'TIMEOUT'
}

/**
 * Chain information related to IBC transfer
 */
export interface ChainInfo {
    chain_id: string;
    chain_name: string;
}

/**
 * Transfer chain context
 */
export interface TransferChainContext {
    source: ChainInfo;
    destination: ChainInfo;
}

/**
 * IBC transfer data structure
 */
export interface IBCTransferData {
    // Transfer details
    sender: string;
    receiver: string;
    denom: string;
    amount: string;
    
    // Transaction metadata
    tx_hash: string;
    
    // Timing information
    send_time: Date;
    
    // Status tracking
    status?: IBCTransferStatus;
    success: boolean;
    
    // Display information
    token_symbol: string;
    token_display_amount: string;
    
    // Chain information
    source_chain_id: string;
    destination_chain_id: string;
    source_chain_name: string;
    destination_chain_name: string;
    
    // Channel information (for channel filtering)
    source_channel?: string;
    destination_channel?: string;
    
    // Completion information
    completion_tx_hash?: string;
    completion_height?: number;
    completion_timestamp?: Date;
    complete_time?: Date;
    
    // Timeout information
    timeout_tx_hash?: string;
    timeout_height?: number;
    timeout_timestamp?: Date;
    
    // Error information
    error?: string;
    
    // Update tracking
    updated_at?: Date;
    
    // Network
    network: string;
}

/**
 * IBC packet information
 */
export interface IBCPacketInfo {
    sourcePort: string;
    sourceChannel: string;
    destPort: string;
    destChannel: string;
    sequence: string;
    packetId: string;
}
