import mongoose from 'mongoose';

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
  overflowCount: {
    type: Number,
    required: true,
    default: 0
  },
  overflowStakeBTC: {
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
  }
}, {
  timestamps: true
});

export const FinalityProvider = mongoose.model('FinalityProvider', finalityProviderSchema); 