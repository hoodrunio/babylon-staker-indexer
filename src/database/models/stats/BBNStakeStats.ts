import mongoose from 'mongoose';

const BBNStakeStatsSchema = new mongoose.Schema({
    date: { 
        type: Date, 
        required: true, 
        index: true 
    },
    periodType: { 
        type: String, 
        required: true, 
        enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'ALL_TIME'],
        index: true
    },
    networkType: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet'],
        index: true
    },
    totalStakes: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    totalStakeAmount: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    activeStakes: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    newStakes: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    unbondedStakes: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    validators: {
        type: Number,
        required: true,
        default: 0
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'bbn_stake_stats'
});

// Compound indexes for common query patterns
BBNStakeStatsSchema.index({ networkType: 1, periodType: 1, date: -1 });
BBNStakeStatsSchema.index({ periodType: 1, networkType: 1 });

export const BBNStakeStats = mongoose.model('BBNStakeStats', BBNStakeStatsSchema); 