import mongoose from 'mongoose';

// Define schema for instantiate_permission
const instantiatePermissionSchema = new mongoose.Schema({
  permission: {
    type: String,
    enum: ['Nobody', 'Everybody', 'AnyOfAddresses', 'OnlyAddress'],
    default: 'Everybody'
  },
  addresses: {
    type: [String],
    default: []
  }
}, { _id: false });

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
  checksum: {
    type: String,
    required: true
  },
  created_at: {
    type: Date,
    required: true
  },
  instantiate_permission: {
    type: instantiatePermissionSchema,
    default: () => ({
      permission: 'Everybody',
      addresses: []
    })
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
    default: null
  },
  optimizer_version: {
    type: String,
    default: null
  },
  contract_count: {
    type: Number,
    default: 0,
    index: true
  }
}, { timestamps: true });

export const Code = mongoose.model('Code', codeSchema);
