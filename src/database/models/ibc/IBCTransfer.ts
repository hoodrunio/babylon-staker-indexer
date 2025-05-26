import mongoose, { Schema, Document } from 'mongoose';

export interface IBCTransfer extends Document {
  packet_id: mongoose.Types.ObjectId; // Reference to the IBCPacket
  sender: string;
  receiver: string;
  amount: string;          // Original denomination amount (e.g., "1000000")
  denom: string;           // Original denomination (e.g., "ubbn")
  success: boolean;        // Whether the transfer was successful
  
  // Token information
  token_symbol?: string;   // e.g., "BABY"
  token_display_amount?: string; // Formatted amount for display (e.g., "1.0")
  
  // Chain information
  source_chain_id: string;
  destination_chain_id: string;
  source_chain_name?: string;      // Human-readable name for source chain
  destination_chain_name?: string; // Human-readable name for destination chain
  
  // Channel information (for channel filtering)
  source_channel?: string;         // Source channel ID
  destination_channel?: string;    // Destination channel ID
  
  // Timing information
  send_time: Date;
  complete_time?: Date;
  
  // Network metadata
  network: string; // 'mainnet' or 'testnet'
  
  // External references
  tx_hash: string;
}

const IBCTransferSchema = new Schema<IBCTransfer>({
  packet_id: { type: Schema.Types.ObjectId, ref: 'IBCPacket', required: true },
  sender: { type: String, required: true },
  receiver: { type: String, required: true },
  amount: { type: String, required: true },
  denom: { type: String, required: true },
  success: { type: Boolean, default: false },
  
  // Token information
  token_symbol: { type: String },
  token_display_amount: { type: String },
  
  // Chain information
  source_chain_id: { type: String, required: true },
  destination_chain_id: { type: String, required: true },
  source_chain_name: { type: String },
  destination_chain_name: { type: String },
  
  // Channel information (for channel filtering)
  source_channel: { type: String },
  destination_channel: { type: String },
  
  // Timing information
  send_time: { type: Date, required: true },
  complete_time: { type: Date },
  
  // Network metadata
  network: { type: String, enum: ['mainnet', 'testnet'], required: true },
  
  // External references
  tx_hash: { type: String, required: true }
});

// Indexes for queries
IBCTransferSchema.index({ tx_hash: 1, network: 1 });
IBCTransferSchema.index({ packet_id: 1 });
IBCTransferSchema.index({ sender: 1 });
IBCTransferSchema.index({ receiver: 1 });
IBCTransferSchema.index({ send_time: -1 });
IBCTransferSchema.index({ source_chain_id: 1, destination_chain_id: 1 });
IBCTransferSchema.index({ denom: 1 });
IBCTransferSchema.index({ success: 1 });
IBCTransferSchema.index({ source_channel: 1, destination_channel: 1 });

export default mongoose.model<IBCTransfer>('IBCTransfer', IBCTransferSchema);
