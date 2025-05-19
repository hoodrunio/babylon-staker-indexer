import mongoose, { Schema, Document } from 'mongoose';

export interface IBCMetrics extends Document {
  // Identifier information
  metric_type: 'channel' | 'relayer' | 'chain';
  reference_id: string;  // channel_id+port_id / relayer_address / chain_id
  timestamp: Date;
  period: 'hourly' | 'daily' | 'weekly';
  
  // Activity metrics
  packet_count: number;
  success_count: number;
  failure_count: number;
  timeout_count: number;
  
  // Performance metrics
  avg_completion_time_ms: number;
  
  // Volume metrics
  tokens_transferred: {
    denom: string;
    amount: string;
  }[];
  
  // Network metadata
  network: string; // 'mainnet' or 'testnet'
}

const IBCMetricsSchema = new Schema<IBCMetrics>({
  // Identifier information
  metric_type: { 
    type: String, 
    enum: ['channel', 'relayer', 'chain'],
    required: true
  },
  reference_id: { type: String, required: true },
  timestamp: { type: Date, required: true },
  period: { 
    type: String, 
    enum: ['hourly', 'daily', 'weekly'],
    required: true
  },
  
  // Activity metrics
  packet_count: { type: Number, default: 0 },
  success_count: { type: Number, default: 0 },
  failure_count: { type: Number, default: 0 },
  timeout_count: { type: Number, default: 0 },
  
  // Performance metrics
  avg_completion_time_ms: { type: Number, default: 0 },
  
  // Volume metrics
  tokens_transferred: [{
    denom: { type: String, required: true },
    amount: { type: String, required: true }
  }],
  
  // Network metadata
  network: { type: String, enum: ['mainnet', 'testnet'], required: true }
});

// Compound index for uniqueness and time-series queries
IBCMetricsSchema.index({ 
  metric_type: 1, 
  reference_id: 1, 
  timestamp: 1, 
  period: 1,
  network: 1
}, { unique: true });

// Performance indexes
IBCMetricsSchema.index({ timestamp: -1 });
IBCMetricsSchema.index({ packet_count: -1 });
IBCMetricsSchema.index({ success_count: -1 });

export default mongoose.model<IBCMetrics>('IBCMetrics', IBCMetricsSchema);
