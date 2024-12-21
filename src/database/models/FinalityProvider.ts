import mongoose from 'mongoose';

const stakerSchema = new mongoose.Schema({
  address: { type: String, required: true },
  stake: { type: Number, required: true }
}, { _id: false });

const phaseStakeSchema = new mongoose.Schema({
  phase: { type: Number, required: true },
  totalStake: { type: Number, required: true, default: 0 },
  transactionCount: { type: Number, required: true, default: 0 },
  stakerCount: { type: Number, required: true, default: 0 },
  stakers: [stakerSchema]
}, { _id: false });

const finalityProviderSchema = new mongoose.Schema({
  address: { 
    type: String, 
    required: true, 
    unique: true 
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
  uniqueStakers: { 
    type: [String], 
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
  versionsUsed: { 
    type: [Number], 
    default: [] 
  },
  phaseStakes: {
    type: [phaseStakeSchema],
    default: []
  }
}, {
  timestamps: true
});

export const FinalityProvider = mongoose.model('FinalityProvider', finalityProviderSchema);