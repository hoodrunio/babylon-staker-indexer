import mongoose, { Schema, Document } from 'mongoose';

export interface IBCConnection extends Document {
  connection_id: string;
  client_id: string;
  counterparty_connection_id: string;
  counterparty_client_id: string;
  counterparty_chain_id: string;
  state: 'INIT' | 'TRYOPEN' | 'OPEN';
  delay_period: number;
  created_at: Date;
  updated_at: Date;
  
  // Analytics fields
  channel_count: number;
  last_activity: Date;
  
  // Network metadata
  network: string; // 'mainnet' or 'testnet'
}

const IBCConnectionSchema = new Schema<IBCConnection>({
  connection_id: { type: String, required: true },
  client_id: { type: String, required: true },
  counterparty_connection_id: { type: String, required: true },
  counterparty_client_id: { type: String, required: true },
  counterparty_chain_id: { type: String, required: true },
  state: { 
    type: String, 
    enum: ['INIT', 'TRYOPEN', 'OPEN'],
    required: true 
  },
  delay_period: { type: Number, required: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  
  // Analytics fields
  channel_count: { type: Number, default: 0 },
  last_activity: { type: Date, default: Date.now },
  
  // Network metadata
  network: { type: String, enum: ['mainnet', 'testnet'], required: true }
});

// Compound index for quick lookups
IBCConnectionSchema.index({ connection_id: 1, network: 1 }, { unique: true });
// Index for analytics queries
IBCConnectionSchema.index({ counterparty_chain_id: 1 });
IBCConnectionSchema.index({ client_id: 1 });
IBCConnectionSchema.index({ last_activity: -1 });

export default mongoose.model<IBCConnection>('IBCConnection', IBCConnectionSchema);
