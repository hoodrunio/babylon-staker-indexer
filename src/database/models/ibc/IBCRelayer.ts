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
  
  // Volume tracking - REFACTORED: Only native amounts, USD calculated real-time
  volumes_by_chain: Map<string, Map<string, number>>; // chain_id -> { denom -> amount }
  volumes_by_denom: Map<string, number>; // denom -> total amount across all chains
  
  // Channel activity
  active_channels: {
    channel_id: string;
    port_id: string;
    count: number;
    volumes_by_denom: Map<string, number>; // REFACTORED: native amounts only
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
  
  // Volume tracking - REFACTORED: Only native amounts
  volumes_by_chain: { 
    type: Map, 
    of: {
      type: Map,
      of: Number
    },
    default: new Map() 
  },
  volumes_by_denom: { 
    type: Map, 
    of: Number,
    default: new Map() 
  },
  
  // Channel activity
  active_channels: [{
    channel_id: { type: String, required: true },
    port_id: { type: String, required: true },
    count: { type: Number, default: 0 },
    volumes_by_denom: { 
      type: Map, 
      of: Number,
      default: new Map() 
    }
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

// Volume indexes for analytics (now based on native amounts)
IBCRelayerSchema.index({ 'volumes_by_denom': 1 });
IBCRelayerSchema.index({ 'volumes_by_chain': 1 });

export default mongoose.model<IBCRelayer>('IBCRelayer', IBCRelayerSchema);
