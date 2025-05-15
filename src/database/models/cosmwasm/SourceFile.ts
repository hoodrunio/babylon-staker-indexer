import mongoose from 'mongoose';

// Schema for individual source files
const sourceFileSchema = new mongoose.Schema({
  code_id: {
    type: Number,
    required: true,
    index: true
  },
  path: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  last_modified: {
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

// Compound unique index for code_id, path, and network
sourceFileSchema.index({ code_id: 1, path: 1, network: 1 }, { unique: true });

export const SourceFile = mongoose.model('SourceFile', sourceFileSchema); 