/**
 * Mongoose model for storing transaction data in the database
 */

import mongoose, { Document, Schema } from 'mongoose';
import { TxStatus } from '../../../services/block-processor/types/common';

// Fee sub-schema
const FeeAmountSchema = new Schema({
  denom: { type: String, required: true },
  amount: { type: String, required: true }
}, { _id: false });

const FeeSchema = new Schema({
  amount: { type: [FeeAmountSchema], default: [] },
  gasLimit: { type: String, required: true }
}, { _id: false });

// TxMessage sub-schema
const TxMessageSchema = new Schema({
  typeUrl: { type: String, required: true },
  content: { type: Schema.Types.Mixed, required: true }
}, { _id: false });

// Transaction schema
export interface ITransaction extends Document {
  txHash: string;
  height: string;
  status: string;
  fee: {
    amount: Array<{
      denom: string;
      amount: string;
    }>;
    gasLimit: string;
  };
  messageCount: number;
  type: string;
  time: string;
  meta: Array<{
    typeUrl: string;
    content: any;
  }>;
  network: string;
  createdAt: Date;
  updatedAt: Date;
  reason?: string;
  firstMessageType?: string;
  isLite?: boolean;
}

const TransactionSchema = new Schema({
  txHash: { 
    type: String, 
    required: true,
    unique: true,
    index: true 
  },
  height: { 
    type: String, 
    required: true,
    index: true 
  },
  status: { 
    type: String, 
    required: true,
    enum: Object.values(TxStatus),
    default: TxStatus.PENDING,
    index: true
  },
  fee: { 
    type: FeeSchema, 
    required: true 
  },
  messageCount: { 
    type: Number, 
    required: true 
  },
  type: { 
    type: String, 
    required: true,
    index: true 
  },
  time: { 
    type: String, 
    required: true,
    index: true 
  },
  meta: { 
    type: [TxMessageSchema], 
    default: [] 
  },
  network: {
    type: String,
    required: true,
    enum: ['MAINNET', 'TESTNET'],
    index: true
  },
  reason: {
    type: String,
    required: false
  },
  firstMessageType: {
    type: String,
    required: false,
    index: true
  },
  isLite: {
    type: Boolean,
    required: false,
    default: false,
    index: true
  }
}, { 
  timestamps: true,
  versionKey: false
});

// Compound indexes
TransactionSchema.index({ height: 1, network: 1 }, { collation: { locale: 'en_US', numericOrdering: true } });
TransactionSchema.index({ txHash: 1, network: 1 }, { unique: true });
TransactionSchema.index({ type: 1, time: 1 });
TransactionSchema.index({ 'meta.typeUrl': 1 });
// Optimized index for aggregation pipeline
TransactionSchema.index({ network: 1, height: -1, time: -1 }, { collation: { locale: 'en_US', numericOrdering: true } });
// Optimized index for countRecentFullTxsByType query - this query is causing performance issues
TransactionSchema.index({ network: 1, 'meta.typeUrl': 1, isLite: 1, createdAt: 1 });

// Model create and export
export const BlockchainTransaction = mongoose.model<ITransaction>('BlockchainTransaction', TransactionSchema); 