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

export const Transaction = mongoose.model('Transaction', transactionSchema);