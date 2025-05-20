import mongoose, { Schema, Document } from 'mongoose';

export interface IBCState extends Document {
  // Identifier for the state entry
  key: string;
  
  // Blockchain state information
  last_processed_block: number;
  last_processed_time: Date;
  
  // Sync status
  is_syncing: boolean;
  sync_start_time?: Date;
  sync_end_time?: Date;
  
  // Network metadata
  network: string; // 'mainnet' or 'testnet'
}

const IBCStateSchema = new Schema<IBCState>({
  key: { type: String, required: true },
  
  // Blockchain state information
  last_processed_block: { type: Number, required: true, default: 0 },
  last_processed_time: { type: Date, default: Date.now },
  
  // Sync status
  is_syncing: { type: Boolean, default: false },
  sync_start_time: { type: Date },
  sync_end_time: { type: Date },
  
  // Network metadata
  network: { type: String, enum: ['mainnet', 'testnet'], required: true }
});

// Compound index for unique state entries per network
IBCStateSchema.index({ key: 1, network: 1 }, { unique: true });

export default mongoose.model<IBCState>('IBCState', IBCStateSchema);
