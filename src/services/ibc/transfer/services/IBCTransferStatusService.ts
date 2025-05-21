import { IIBCTransferStatusService } from '../interfaces/IBCServices';
import { IBCTransferData, IBCTransferStatus } from '../types/IBCTransferTypes';

/**
 * Service responsible for managing IBC transfer status updates
 */
export class IBCTransferStatusService implements IIBCTransferStatusService {
    /**
     * Determine if an acknowledgment was successful based on event attributes
     * @param attributes Event attributes
     * @returns Whether the acknowledgment was successful
     */
    public isSuccessfulAcknowledgement(attributes: Record<string, string>): boolean {
        // Check for explicit error indicators
        const hasError = !!attributes.packet_ack_error || !!attributes.error;
        
        // Check for acknowledgment string content if available
        const ackString = attributes.packet_ack || attributes.acknowledgement;
        if (ackString) {
            // Some chains use JSON format for acks
            try {
                const ackData = JSON.parse(ackString);
                // Check for common error formats
                if (ackData.error || ackData.code || (ackData.result === 'error')) {
                    return false;
                }
            } catch {
                // If not valid JSON, just check for error substrings
                if (ackString.includes('error') || ackString.includes('Error')) {
                    return false;
                }
            }
        }
        
        return !hasError;
    }
    
    /**
     * Update transfer data for acknowledgement event
     * @param transfer Existing transfer data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Event timestamp
     * @param isSuccessful Whether acknowledgement was successful
     * @param error Optional error message
     * @returns Updated transfer data
     */
    public updateTransferForAcknowledgement(
        transfer: IBCTransferData, 
        txHash: string, 
        height: number, 
        timestamp: Date,
        isSuccessful: boolean,
        error?: string
    ): IBCTransferData {
        return {
            ...transfer,
            status: isSuccessful ? IBCTransferStatus.COMPLETED : IBCTransferStatus.FAILED,
            success: isSuccessful,
            completion_tx_hash: txHash,
            completion_height: height,
            completion_timestamp: timestamp,
            error: error,
            updated_at: timestamp
        };
    }
    
    /**
     * Update transfer data for timeout event
     * @param transfer Existing transfer data
     * @param txHash Transaction hash
     * @param height Block height
     * @param timestamp Event timestamp
     * @returns Updated transfer data
     */
    public updateTransferForTimeout(
        transfer: IBCTransferData, 
        txHash: string, 
        height: number, 
        timestamp: Date
    ): IBCTransferData {
        return {
            ...transfer,
            status: IBCTransferStatus.TIMEOUT,
            success: false,
            timeout_tx_hash: txHash,
            timeout_height: height,
            timeout_timestamp: timestamp,
            error: 'Packet timed out',
            updated_at: timestamp
        };
    }
}
