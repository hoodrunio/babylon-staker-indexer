import mongoose, { Schema, Document } from 'mongoose';

export interface PhaseStats extends Document {
  phase: number;
  startHeight: number;
  currentHeight: number;
  endHeight?: number;
  totalStakeBTC: number;
  totalTransactions: number;
  uniqueStakers: number;
  lastStakeHeight: number;
  lastUpdateTime: Date;
  status: 'active' | 'completed';
  completionReason?: 'target_reached' | 'timeout' | 'inactivity' | 'block_height';
  overflowCount: number;
  overflowStakeBTC: number;
}

const PhaseStatsSchema = new Schema<PhaseStats>({
  phase: { type: Number, required: true, unique: true },
  startHeight: { type: Number, required: true },
  currentHeight: { type: Number, required: true },
  endHeight: { type: Number },
  totalStakeBTC: { type: Number, required: true, default: 0 },
  totalTransactions: { type: Number, required: true, default: 0 },
  uniqueStakers: { type: Number, required: true, default: 0 },
  lastStakeHeight: { type: Number, required: true },
  lastUpdateTime: { type: Date, required: true },
  status: { type: String, required: true, enum: ['active', 'completed'] },
  completionReason: { type: String, enum: ['target_reached', 'timeout', 'inactivity', 'block_height'] },
  overflowCount: { type: Number, required: true, default: 0 },
  overflowStakeBTC: { type: Number, required: true, default: 0 }
}, {
  timestamps: true,
  collection: 'phasestats'
});

// Remove old indexes and define new ones
PhaseStatsSchema.index({ phase: 1 }, { unique: true, name: 'idx_phase_unique' });
PhaseStatsSchema.index({ status: 1 }, { name: 'idx_status' });
PhaseStatsSchema.index({ startHeight: 1, endHeight: 1 }, { name: 'idx_height_range' });
PhaseStatsSchema.index({ phase: 1, status: 1, totalStakeBTC: 1 }, { name: 'idx_phase_stats' });

export const PhaseStats = mongoose.model<PhaseStats>('PhaseStats', PhaseStatsSchema);
