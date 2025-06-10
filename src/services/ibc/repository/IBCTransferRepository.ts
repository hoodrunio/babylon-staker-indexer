import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';
import IBCTransfer from '../../../database/models/ibc/IBCTransfer';
import mongoose from 'mongoose';

/**
 * Repository for managing IBC transfer data
 */
export class IBCTransferRepository {
    /**
     * Save or update a transfer in the database
     */
    public async saveTransfer(transferData: any, packetId: mongoose.Types.ObjectId, network: Network): Promise<any> {
        try {
            // Log the packet ID and key transfer data for debugging
            logger.debug(`[IBCTransferRepository] Saving transfer with packetId ${packetId.toString()}`);
            logger.debug(`[IBCTransferRepository] Transfer details: amount=${transferData.amount}, denom=${transferData.denom}, tx=${transferData.tx_hash}`);
            
            // Ensure we have all required fields as defined in the schema
            const requiredFields = [
                'sender',
                'receiver',
                'amount',
                'denom',
                'source_chain_id',
                'destination_chain_id',
                'send_time',
                'tx_hash'
            ];
            
            // For updates, try to get existing document first to preserve required fields
            let existingTransfer = null;
            try {
                existingTransfer = await IBCTransfer.findOne({ 
                    packet_id: packetId,
                    network: network.toString() 
                });
            } catch (error) {
                logger.debug(`[IBCTransferRepository] No existing transfer found for packetId ${packetId.toString()}`);
            }
            
            // Create merged data preserving required fields from existing document
            const mergedData = { ...transferData };
            
            // If we're updating an existing record, preserve required fields
            if (existingTransfer) {
                // Access the document data safely (toObject() is type-safe)
                const existingDoc = existingTransfer.toObject ? existingTransfer.toObject() : existingTransfer;
                
                // For each required field, use existing value if it's missing in the update
                for (const field of requiredFields) {
                    // Type-safe way to check and access properties
                    const hasValue = field in existingDoc && existingDoc[field as keyof typeof existingDoc] !== undefined;
                    const isMissing = !(field in mergedData) || mergedData[field] === undefined || mergedData[field] === null;
                    
                    if (isMissing && hasValue) {
                        logger.debug(`[IBCTransferRepository] Preserving required field ${field} from existing document`);
                        // Type assertion to handle the dynamic field access
                        mergedData[field] = existingDoc[field as keyof typeof existingDoc] as any;
                    }
                }
            }
            
            // Verify all required fields are present after merging
            const missingFields = requiredFields.filter(field => !mergedData[field]);
            
            if (missingFields.length > 0) {
                logger.error(`[IBCTransferRepository] Missing required transfer data fields after merge: ${missingFields.join(', ')}`);
                logger.error(`[IBCTransferRepository] Transfer data: ${JSON.stringify(mergedData)}`);
                throw new Error(`Missing required transfer data fields: ${missingFields.join(', ')}`);
            }

            // Make sure fields match the schema
            const transferDocument = {
                ...mergedData,
                packet_id: packetId,  // Use the provided packet ID
                network: network.toString(), // Ensure network is a string
                success: mergedData.success ?? false, // Default to false if not provided
                send_time: mergedData.send_time || new Date() // Ensure we have a timestamp
            };

            // Save to database with detailed error handling
            try {
                const result = await IBCTransfer.findOneAndUpdate(
                    { 
                        packet_id: packetId,
                        network: network.toString()
                    },
                    transferDocument,
                    { upsert: true, new: true }
                );
                
                logger.info(`[IBCTransferRepository] Successfully saved transfer with ID: ${result._id} for packet: ${packetId}`);
                return result;
            } catch (dbError) {
                // Log specific MongoDB errors
                logger.error(`[IBCTransferRepository] MongoDB error: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
                logger.error(`[IBCTransferRepository] Document: ${JSON.stringify(transferDocument)}`);
                throw dbError;
            }
        } catch (error) {
            logger.error(`[IBCTransferRepository] Error saving transfer: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get a transfer by packet ID
     */
    public async getTransferByPacketId(packetId: mongoose.Types.ObjectId, network: Network): Promise<any> {
        try {
            logger.debug(`[IBCTransferRepository] Getting transfer for packet_id=${packetId.toString()}, network=${network.toString()}`);
            
            // Check if the packet ID is valid
            if (!packetId || !mongoose.Types.ObjectId.isValid(packetId)) {
                logger.error(`[IBCTransferRepository] Invalid packet ID: ${packetId}`);
                return null;
            }
            
            // Perform query with additional error handling
            try {
                const transfer = await IBCTransfer.findOne({ 
                    packet_id: packetId,
                    network: network.toString() 
                });
                
                if (transfer) {
                    logger.debug(`[IBCTransferRepository] Found transfer for packet_id=${packetId.toString()}`);
                } else {
                    logger.debug(`[IBCTransferRepository] No transfer found for packet_id=${packetId.toString()}`);
                    
                    // As an extra check, let's try to see if any transfer exists without network filter
                    const anyTransfer = await IBCTransfer.findOne({ packet_id: packetId });
                    if (anyTransfer) {
                        logger.warn(`[IBCTransferRepository] Found transfer for packet_id=${packetId.toString()} but with network=${anyTransfer.network} instead of ${network.toString()}`);
                    }
                }
                
                return transfer;
            } catch (dbError) {
                logger.error(`[IBCTransferRepository] Database error getting transfer: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
                return null;
            }
        } catch (error) {
            logger.error(`[IBCTransferRepository] Error getting transfer: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    
    /**
     * Get a transfer by tx hash
     */
    public async getTransferByTxHash(txHash: string, network: Network): Promise<any> {
        try {
            logger.debug(`[IBCTransferRepository] Get transfer for tx_hash=${txHash}`);
            return await IBCTransfer.findOne({ 
                tx_hash: txHash,
                network: network.toString() 
            });
        } catch (error) {
            logger.error(`[IBCTransferRepository] Error getting transfer by tx hash: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Get all transfers for a specific sender
     */
    public async getTransfersBySender(sender: string, network: Network): Promise<any[]> {
        try {
            return await IBCTransfer.find({
                sender: sender,
                network: network.toString()
            }).sort({ send_time: -1 });
        } catch (error) {
            logger.error(`[IBCTransferRepository] Error getting transfers by sender: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Get all transfers for a specific receiver
     */
    public async getTransfersByReceiver(receiver: string, network: Network): Promise<any[]> {
        try {
            return await IBCTransfer.find({
                receiver: receiver,
                network: network.toString()
            }).sort({ send_time: -1 });
        } catch (error) {
            logger.error(`[IBCTransferRepository] Error getting transfers by receiver: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Get all transfers between specific chains
     */
    public async getTransfersByChains(
        sourceChainId: string,
        destinationChainId: string,
        network: Network
    ): Promise<any[]> {
        try {
            return await IBCTransfer.find({
                source_chain_id: sourceChainId,
                destination_chain_id: destinationChainId,
                network: network.toString()
            }).sort({ send_time: -1 });
        } catch (error) {
            logger.error(`[IBCTransferRepository] Error getting transfers by chains: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Mark a transfer as successful (completed)
     */
    public async markTransferComplete(packetId: mongoose.Types.ObjectId, network: Network): Promise<any> {
        try {
            // Always set complete_time to the current time when marking as complete
            const completeTime = new Date();
            
            return await IBCTransfer.findOneAndUpdate(
                { packet_id: packetId, network: network.toString() },
                { 
                    $set: { 
                        success: true, 
                        complete_time: completeTime
                    } 
                },
                { new: true }
            );
        } catch (error) {
            logger.error(`[IBCTransferRepository] Error marking transfer complete: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get transfers within a specific time period
     * @param startDate Period start date
     * @param endDate Period end date
     * @param network Network to query
     * @returns Array of IBC transfers within the specified period
     */
    async getTransfersInPeriod(startDate: Date, endDate: Date, network: Network): Promise<any[]> {
        try {            
            const query = {
                network: network.toString(),
                send_time: { $gte: startDate, $lte: endDate }
            };            
            const transfers = await IBCTransfer.find(query).lean();            
            return transfers;
        } catch (error) {
            logger.error(`[IBCTransferRepository] Error getting transfers in period: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
}
