import mongoose, { Schema, Document } from 'mongoose';

export interface IBCRelayer extends Document {
  address: string;
  first_seen_at: Date;
  last_active_at: Date;
  
  // Performance metrics
  total_packets_relayed: number;
  successful_packets: number;
  failed_packets: number;
  avg_relay_time_ms: number;
  
  // Channel activity
  active_channels: {
    channel_id: string;
    port_id: string;
    count: number;
  }[];
  
  // Chain activity
  chains_served: string[];
  
  // Network metadata
  network: string; // 'mainnet' or 'testnet'
}

const IBCRelayerSchema = new Schema<IBCRelayer>({
  address: { type: String, required: true },
  first_seen_at: { type: Date, default: Date.now },
  last_active_at: { type: Date, default: Date.now },
  
  // Performance metrics
  total_packets_relayed: { type: Number, default: 0 },
  successful_packets: { type: Number, default: 0 },
  failed_packets: { type: Number, default: 0 },
  avg_relay_time_ms: { type: Number, default: 0 },
  
  // Channel activity
  active_channels: [{
    channel_id: { type: String, required: true },
    port_id: { type: String, required: true },
    count: { type: Number, default: 0 }
  }],
  
  // Chain activity
  chains_served: [{ type: String }],
  
  // Network metadata
  network: { type: String, enum: ['mainnet', 'testnet'], required: true }
});

// Compound index for uniqueness
IBCRelayerSchema.index({ address: 1, network: 1 }, { unique: true });

// Performance indexes
IBCRelayerSchema.index({ total_packets_relayed: -1 });
IBCRelayerSchema.index({ successful_packets: -1 });
IBCRelayerSchema.index({ avg_relay_time_ms: 1 });
IBCRelayerSchema.index({ last_active_at: -1 });

export default mongoose.model<IBCRelayer>('IBCRelayer', IBCRelayerSchema);
