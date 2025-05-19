import mongoose, { Schema, Document } from 'mongoose';

export interface IBCClient extends Document {
  client_id: string;
  client_type: string; // 07-tendermint, 06-solomachine, etc.
  chain_id: string;    // The chain this client is tracking (counterparty chain)
  latest_height: number;
  frozen: boolean;
  created_at: Date;
  updated_at: Date;
  
  // Analytics fields
  connection_count: number;
  last_update: Date;
  
  // Network metadata
  network: string; // 'mainnet' or 'testnet'
}

const IBCClientSchema = new Schema<IBCClient>({
  client_id: { type: String, required: true },
  client_type: { type: String, required: true },
  chain_id: { type: String, required: true },
  latest_height: { type: Number, required: true },
  frozen: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  
  // Analytics fields
  connection_count: { type: Number, default: 0 },
  last_update: { type: Date, default: Date.now },
  
  // Network metadata
  network: { type: String, enum: ['mainnet', 'testnet'], required: true }
});

// Compound index for quick lookups
IBCClientSchema.index({ client_id: 1, network: 1 }, { unique: true });
// Index for analytics queries
IBCClientSchema.index({ chain_id: 1 });
IBCClientSchema.index({ last_update: -1 });
IBCClientSchema.index({ client_type: 1 });

export default mongoose.model<IBCClient>('IBCClient', IBCClientSchema);
