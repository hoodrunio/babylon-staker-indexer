/**
 * Mongoose model for storing block data in the database
 */

import mongoose, { Document, Schema } from 'mongoose';

// Signature sub-schema
const SignatureSchema = new Schema({
  validator: { 
    type: Schema.Types.ObjectId, 
    ref: 'ValidatorInfo', 
    required: true 
  },
  timestamp: { type: String, required: true }
}, { _id: false });

// Block schema
export interface IBlock extends Document {
  height: string;
  blockHash: string;
  proposer: mongoose.Types.ObjectId;
  numTxs: number;
  time: string;
  signatures: Array<{
    validator: mongoose.Types.ObjectId;
    timestamp: string;
    signature: string;
  }>;
  appHash: string;
  totalGasWanted: string;
  totalGasUsed: string;
  network: string;
  createdAt: Date;
  updatedAt: Date;
}

const BlockSchema = new Schema({
  height: { 
    type: String, 
    required: true,
    index: true 
  },
  blockHash: { 
    type: String, 
    required: true,
    unique: true,
    index: true 
  },
  proposer: { 
    type: Schema.Types.ObjectId, 
    ref: 'ValidatorInfo',
    required: true,
    index: true 
  },
  numTxs: { 
    type: Number, 
    required: true 
  },
  time: { 
    type: String, 
    required: true 
  },
  signatures: { 
    type: [SignatureSchema], 
    default: [] 
  },
  appHash: { 
    type: String, 
    required: true 
  },
  totalGasWanted: {
    type: String,
    default: "0"
  },
  totalGasUsed: {
    type: String,
    default: "0"
  },
  network: {
    type: String,
    required: true,
    enum: ['MAINNET', 'TESTNET'],
    index: true
  }
}, { 
  timestamps: true,
  versionKey: false
});

// Compound indexes
BlockSchema.index({ height: 1, network: 1 }, { 
  unique: true,
  collation: { locale: 'en_US', numericOrdering: true } 
});
BlockSchema.index({ time: 1 });

// Model create and export
export const Block = mongoose.model<IBlock>('Block', BlockSchema); 