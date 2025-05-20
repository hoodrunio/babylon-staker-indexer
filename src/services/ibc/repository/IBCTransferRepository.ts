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
            logger.debug(`[IBCTransferRepository] Save transfer data for network ${network}: ${JSON.stringify(transferData)}`);
            
            return await IBCTransfer.findOneAndUpdate(
                { 
                    packet_id: packetId,
                    network: network.toString()
                },
                {
                    ...transferData,
                    packet_id: packetId,
                    network: network.toString()
                },
                { upsert: true, new: true }
            );
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
            logger.debug(`[IBCTransferRepository] Get transfer for packet_id=${packetId}`);
            return await IBCTransfer.findOne({ 
                packet_id: packetId,
                network: network.toString() 
            });
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
            return await IBCTransfer.findOneAndUpdate(
                { packet_id: packetId, network: network.toString() },
                { 
                    $set: { 
                        success: true, 
                        complete_time: new Date() 
                    } 
                },
                { new: true }
            );
        } catch (error) {
            logger.error(`[IBCTransferRepository] Error marking transfer complete: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
