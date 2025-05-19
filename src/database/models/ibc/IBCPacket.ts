import mongoose, { Schema, Document } from 'mongoose';

export interface IBCPacket extends Document {
  sequence: number;
  source_port: string;
  source_channel: string;
  destination_port: string;
  destination_channel: string;
  data_hex: string;
  timeout_height: {
    revision_number: number;
    revision_height: number;
  };
  timeout_timestamp: number;
  
  // Packet status
  status: 'SENT' | 'RECEIVED' | 'ACKNOWLEDGED' | 'TIMEOUT';
  
  // Transaction info
  send_tx_hash?: string;
  receive_tx_hash?: string;
  ack_tx_hash?: string;
  timeout_tx_hash?: string;
  
  // Timing data
  send_time?: Date;
  receive_time?: Date;
  ack_time?: Date;
  timeout_time?: Date;
  
  // Relayer information
  relayer_address?: string;
  
  // Analytics
  completion_time_ms?: number;
  
  // Network metadata
  network: string; // 'mainnet' or 'testnet'
  source_chain_id: string;
  destination_chain_id: string;
}

const IBCPacketSchema = new Schema<IBCPacket>({
  sequence: { type: Number, required: true },
  source_port: { type: String, required: true },
  source_channel: { type: String, required: true },
  destination_port: { type: String, required: true },
  destination_channel: { type: String, required: true },
  data_hex: { type: String, required: true },
  timeout_height: {
    revision_number: { type: Number, required: true },
    revision_height: { type: Number, required: true }
  },
  timeout_timestamp: { type: Number, required: true },
  
  // Packet status
  status: { 
    type: String, 
    enum: ['SENT', 'RECEIVED', 'ACKNOWLEDGED', 'TIMEOUT'],
    required: true,
    default: 'SENT'
  },
  
  // Transaction info
  send_tx_hash: { type: String },
  receive_tx_hash: { type: String },
  ack_tx_hash: { type: String },
  timeout_tx_hash: { type: String },
  
  // Timing data
  send_time: { type: Date },
  receive_time: { type: Date },
  ack_time: { type: Date },
  timeout_time: { type: Date },
  
  // Relayer information
  relayer_address: { type: String },
  
  // Analytics
  completion_time_ms: { type: Number },
  
  // Network metadata
  network: { type: String, enum: ['mainnet', 'testnet'], required: true },
  source_chain_id: { type: String, required: true },
  destination_chain_id: { type: String, required: true }
});

// Compound index for uniquely identifying a packet
IBCPacketSchema.index({ 
  sequence: 1, 
  source_port: 1, 
  source_channel: 1, 
  destination_port: 1, 
  destination_channel: 1,
  network: 1
}, { unique: true });

// Indexes for analytics queries
IBCPacketSchema.index({ status: 1 });
IBCPacketSchema.index({ relayer_address: 1 });
IBCPacketSchema.index({ send_time: -1 });
IBCPacketSchema.index({ completion_time_ms: 1 });
IBCPacketSchema.index({ source_chain_id: 1, destination_chain_id: 1 });

export default mongoose.model<IBCPacket>('IBCPacket', IBCPacketSchema);
