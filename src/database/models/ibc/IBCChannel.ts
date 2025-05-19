import mongoose, { Schema, Document } from 'mongoose';

export interface IBCChannel extends Document {
  channel_id: string;
  port_id: string;
  connection_id: string;
  counterparty_channel_id: string;
  counterparty_port_id: string;
  counterparty_chain_id: string;
  state: 'INIT' | 'TRYOPEN' | 'OPEN' | 'CLOSED';
  ordering: 'ORDERED' | 'UNORDERED';
  version: string;
  created_at: Date;
  updated_at: Date;
  
  // Analytics fields
  packet_count: number;
  success_count: number;
  failure_count: number;
  timeout_count: number;
  avg_completion_time_ms: number;
  total_tokens_transferred: Map<string, number>; // denomination -> amount
  active_relayers: string[];
  
  // Network metadata
  client_id: string;
  network: string; // 'mainnet' or 'testnet'
}

const IBCChannelSchema = new Schema<IBCChannel>({
  channel_id: { type: String, required: true },
  port_id: { type: String, required: true },
  connection_id: { type: String, required: true },
  counterparty_channel_id: { type: String, required: true },
  counterparty_port_id: { type: String, required: true },
  counterparty_chain_id: { type: String, required: true },
  state: { 
    type: String, 
    enum: ['INIT', 'TRYOPEN', 'OPEN', 'CLOSED'],
    required: true 
  },
  ordering: { 
    type: String, 
    enum: ['ORDERED', 'UNORDERED'],
    required: true 
  },
  version: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  
  // Analytics fields
  packet_count: { type: Number, default: 0 },
  success_count: { type: Number, default: 0 },
  failure_count: { type: Number, default: 0 },
  timeout_count: { type: Number, default: 0 },
  avg_completion_time_ms: { type: Number, default: 0 },
  total_tokens_transferred: { 
    type: Map, 
    of: Number,
    default: new Map() 
  },
  active_relayers: [{ type: String }],
  
  // Network metadata
  client_id: { type: String, required: true },
  network: { type: String, enum: ['mainnet', 'testnet'], required: true }
});

// Compound index for quick lookups
IBCChannelSchema.index({ channel_id: 1, port_id: 1, network: 1 }, { unique: true });
// Index for analytics queries
IBCChannelSchema.index({ packet_count: -1 });
IBCChannelSchema.index({ success_count: -1 });
IBCChannelSchema.index({ counterparty_chain_id: 1 });

export default mongoose.model<IBCChannel>('IBCChannel', IBCChannelSchema);
