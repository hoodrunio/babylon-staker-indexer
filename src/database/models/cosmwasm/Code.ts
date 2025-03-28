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
  creation_time: {
    type: Date,
    required: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  source_url: {
    type: String,
    default: null
  },
  source_hash: {
    type: String,
    default: null
  },
  language: {
    type: String,
    default: 'Rust'
  },
  contract_count: {
    type: Number,
    default: 0,
    index: true
  }
}, { timestamps: true });

export const Code = mongoose.model('Code', codeSchema);
