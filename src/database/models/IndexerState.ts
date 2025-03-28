import mongoose from 'mongoose';

const indexerStateSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true
  },
  lastProcessedBlock: {
    type: Number,
    required: true,
    default: 0
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false }); // This allows us to set custom _id field

export const IndexerState = mongoose.model('IndexerState', indexerStateSchema);