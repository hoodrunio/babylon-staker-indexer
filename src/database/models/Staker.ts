import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  txid: { type: String, required: true },
  phase: { type: Number, required: true },
  timestamp: { type: Number, required: true },
  amount: { type: Number, required: true },
  finalityProvider: { type: String, required: true }
}, { _id: false });

const finalityProviderStakeSchema = new mongoose.Schema({
  address: { type: String, required: true },
  stake: { type: Number, required: true }
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
    unique: true,
    index: true,
    collation: { locale: 'en', strength: 2 }
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
  finalityProviders: { 
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
  transactions: {
    type: [transactionSchema],
    default: []
  },
  phaseStakes: {
    type: [phaseStakeSchema],
    default: []
  }
}, {
  timestamps: true
});

stakerSchema.index(
  { address: 1, firstSeen: 1, lastSeen: 1 },
  { collation: { locale: 'en', strength: 2 } }
);

export const Staker = mongoose.model('Staker', stakerSchema);