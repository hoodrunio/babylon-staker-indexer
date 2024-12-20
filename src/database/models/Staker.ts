import mongoose from 'mongoose';

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
  activeStakes: { 
    type: Number, 
    required: true, 
    default: 0 
  }
}, {
  timestamps: true
});

stakerSchema.index(
  { address: 1, firstSeen: 1, lastSeen: 1 },
  { collation: { locale: 'en', strength: 2 } }
);

export const Staker = mongoose.model('Staker', stakerSchema); 