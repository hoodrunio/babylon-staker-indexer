import mongoose from 'mongoose';

const indexerStateSchema = new mongoose.Schema({
  lastProcessedBlock: {
    type: Number,
    required: true,
    default: 0
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export const IndexerState = mongoose.model('IndexerState', indexerStateSchema); 