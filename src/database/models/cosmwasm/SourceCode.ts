import mongoose from 'mongoose';

// Directory/file node schema for the source code file tree
const fileNodeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['file', 'directory'],
    required: true
  },
  size: {
    type: Number,
    default: null
  },
  last_modified: {
    type: Date,
    default: null
  },
  children: {
    type: [mongoose.Schema.Types.Mixed], // Will reference itself for recursive structure
    default: []
  }
}, { _id: false });

// Self-reference for children
fileNodeSchema.add({ children: [fileNodeSchema] });

// Schema for source code tree
const sourceCodeSchema = new mongoose.Schema({
  code_id: {
    type: Number,
    required: true,
    index: true
  },
  verification_id: {
    type: String,
    required: true,
    index: true
  },
  repository: {
    type: String,
    default: null
  },
  commit_hash: {
    type: String,
    default: null
  },
  root_directory: {
    type: fileNodeSchema,
    default: null
  },
  verified: {
    type: Boolean,
    default: true
  },
  verification_date: {
    type: Date,
    default: Date.now
  },
  network: {
    type: String,
    required: true,
    enum: ['mainnet', 'testnet'],
    index: true
  }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Compound index for code_id and network
sourceCodeSchema.index({ code_id: 1, network: 1 }, { unique: true });

export const SourceCode = mongoose.model('SourceCode', sourceCodeSchema); 