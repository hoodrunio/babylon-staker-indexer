import mongoose from 'mongoose';

const contractSchema = new mongoose.Schema({
  contract_address: {
    type: String,
    required: true,
    unique: true, 
    index: true
  },
  code_id: {
    type: Number,
    required: true,
    index: true
  },
  label: {
    type: String,
    default: null
  },
  admin: {
    type: String, 
    default: null,
    index: true
  },
  init_msg: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  created_at: {
    type: Date,
    required: true
  }
}, { timestamps: true });

export const Contract = mongoose.model('Contract', contractSchema);
