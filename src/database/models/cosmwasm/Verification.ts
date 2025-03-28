import mongoose from 'mongoose';

const verificationSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: () => new mongoose.Types.ObjectId().toString()
  },
  code_id: {
    type: Number,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending'
  },
  uploaded_by: {
    type: String,
    default: null
  },
  uploaded_at: {
    type: Date,
    default: Date.now
  },
  error: {
    type: String,
    default: null
  },
  source_path: {
    type: String,
    default: null
  },
  wasm_hash: {
    type: String,
    default: null
  },
  repo_url: {
    type: String,
    default: null
  },
  branch: {
    type: String,
    default: null
  }
}, { timestamps: { createdAt: 'created_at' } });

export const Verification = mongoose.model('Verification', verificationSchema);
