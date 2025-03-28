import mongoose from 'mongoose';

const codeSchema = new mongoose.Schema({
  code_id: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  creator: {
    type: String,
    required: true,
    index: true
  },
  data_hash: {
    type: String,
    required: true
  },
  created_at: {
    type: Date,
    required: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  source_type: {
    type: String,
    enum: ['zip', 'github', null],
    default: null
  },
  source_url: {
    type: String,
    default: null
  },
  wasm_hash: {
    type: String,
    default: null
  },
  optimizer_type: {
    type: String,
    default: 'rust-optimizer'
  },
  optimizer_version: {
    type: String,
    default: '0.16.0'
  },
  contract_count: {
    type: Number,
    default: 0,
    index: true
  }
}, { timestamps: true });

export const Code = mongoose.model('Code', codeSchema);
