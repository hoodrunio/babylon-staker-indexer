import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  txid: { 
    type: String, 
    required: true, 
    unique: true 
  },
  blockHeight: { 
    type: Number, 
    required: true,
    index: true 
  },
  timestamp: { 
    type: Number, 
    required: true,
    index: true 
  },
  stakeAmount: { 
    type: Number, 
    required: true 
  },
  stakerAddress: { 
    type: String, 
    required: true,
    index: true 
  },
  stakerPublicKey: { 
    type: String, 
    required: true 
  },
  finalityProvider: { 
    type: String, 
    required: true,
    index: true 
  },
  stakingTime: { 
    type: Number, 
    required: true 
  },
  version: { 
    type: Number, 
    required: true,
    index: true 
  },
  paramsVersion: { 
    type: Number, 
    required: true 
  },
  isOverflow: {
    type: Boolean,
    required: true,
    default: false,
    index: true
  },
  overflowAmount: {
    type: Number,
    required: true,
    default: 0
  }
}, {
  timestamps: true
});

// Compound indexes for common query patterns
transactionSchema.index({ stakerAddress: 1, timestamp: 1 }); // For staker queries with time range
transactionSchema.index({ finalityProvider: 1, timestamp: 1 }); // For FP queries with time range
transactionSchema.index({ blockHeight: 1, timestamp: 1 }); // For block height queries with time range
transactionSchema.index({ version: 1, timestamp: 1 }); // For version queries with time range
transactionSchema.index({ isOverflow: 1, timestamp: 1 }); // For overflow queries with time range
transactionSchema.index({ stakerAddress: 1, finalityProvider: 1 }); // For staker-FP relationship queries

export const Transaction = mongoose.model('Transaction', transactionSchema);