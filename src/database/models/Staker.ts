import mongoose from 'mongoose';
import { StakerDocument } from '../../types';

const finalityProviderStakeSchema = new mongoose.Schema({
  address: { type: String, required: true },
  stake: { type: Number, required: true }
}, { _id: false });

const transactionSchema = new mongoose.Schema({
  txid: { type: String, required: true },
  phase: { type: Number, required: true },
  timestamp: { type: Number, required: true },
  amount: { type: Number, required: true },
  finalityProvider: { type: String, required: true }
}, { _id: false });

const phaseStakeSchema = new mongoose.Schema({
  phase: { type: Number, required: true },
  totalStake: { type: Number, required: true, default: 0 },
  transactionCount: { type: Number, required: true, default: 0 },
  finalityProviders: [finalityProviderStakeSchema]
}, { _id: false });

const stakerSchema = new mongoose.Schema({
  address: { 
    type: String, 
    required: true, 
    unique: true 
  },
  stakerPublicKey: {
    type: String,
    sparse: true
  },
  totalStake: { 
    type: Number, 
    required: true, 
    default: 0 
  },
  transactionCount: { 
    type: Number, 
    required: true, 
    default: 0 
  },
  activeStakes: { 
    type: Number, 
    required: true, 
    default: 0 
  },
  uniqueProviders: { 
    type: [String], 
    default: [] 
  },
  versionsUsed: { 
    type: [Number], 
    default: [] 
  },
  firstSeen: { 
    type: Number, 
    required: true 
  },
  lastSeen: { 
    type: Number, 
    required: true 
  },
  phaseStakes: {
    type: [phaseStakeSchema],
    default: []
  },
  transactions: {
    type: [transactionSchema],
    default: []
  }
}, {
  timestamps: true,
  collection: 'stakers'
});

// Create indexes
stakerSchema.index({ address: 1 }, { unique: true });
stakerSchema.index({ totalStake: -1 });
stakerSchema.index({ firstSeen: 1 });
stakerSchema.index({ lastSeen: 1 });

export const Staker = mongoose.model<StakerDocument>('Staker', stakerSchema, 'stakers');