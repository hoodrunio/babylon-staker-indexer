/**
 * Transaction Statistics Model
 * Stores pre-computed statistics about transactions to avoid expensive count operations
 */

import mongoose, { Document, Schema } from 'mongoose';
import { Network } from '../../../types/finality';

/**
 * Interface for Transaction Statistics document
 */
export interface ITransactionStats extends Document {
  /** Network identifier */
  network: Network;
  
  /** Total transaction count for this network */
  totalCount: number;
  
  /** Latest height processed */
  latestHeight: number;
  
  /** Count of transactions by transaction type */
  countByType: Record<string, number>;
  
  /** Last time the statistics were updated */
  lastUpdated: Date;
  
  /** Transaction count within the last 24 hours */
  last24HourCount: number;
}

/**
 * Schema for Transaction Statistics
 */
const TransactionStatsSchema = new Schema({
  network: {
    type: String,
    required: true,
    enum: Object.values(Network),
    index: true,
    unique: true
  },
  totalCount: {
    type: Number,
    required: true,
    default: 0
  },
  latestHeight: {
    type: Number,
    required: true,
    default: 0
  },
  countByType: {
    type: Map,
    of: Number,
    default: {}
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  last24HourCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Create the model
export const TransactionStats = mongoose.model<ITransactionStats>('TransactionStats', TransactionStatsSchema);
