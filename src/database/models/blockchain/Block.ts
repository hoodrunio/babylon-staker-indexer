/**
 * Block Model
 * Blok verilerini veritabanında saklamak için Mongoose modeli
 */

import mongoose, { Document, Schema } from 'mongoose';

// Signature alt şeması
const SignatureSchema = new Schema({
  validatorAddress: { type: String, required: true },
  timestamp: { type: String, required: true },
  signature: { type: String, required: true }
}, { _id: false });

// Block şeması
export interface IBlock extends Document {
  height: string;
  blockHash: string;
  proposerAddress: string;
  numTxs: number;
  time: string;
  signatures: Array<{
    validatorAddress: string;
    timestamp: string;
    signature: string;
  }>;
  appHash: string;
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
  proposerAddress: { 
    type: String, 
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

// Bileşik indeksler
BlockSchema.index({ height: 1, network: 1 }, { unique: true });
BlockSchema.index({ time: 1 });

// Model oluştur ve dışa aktar
export const Block = mongoose.model<IBlock>('Block', BlockSchema); 