import mongoose from 'mongoose';

const BBNTransactionStatsSchema = new mongoose.Schema({
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
    totalTransactions: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    totalVolume: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    activeAccounts: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    transactionsByType: {
        TRANSFER: { type: Number, default: 0 },
        STAKE: { type: Number, default: 0 },
        UNSTAKE: { type: Number, default: 0 },
        REWARD: { type: Number, default: 0 },
        OTHER: { type: Number, default: 0 }
    },
    averageFee: {
        type: Number,
        default: 0
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'bbn_transaction_stats'
});

// Compound indexes for common query patterns
BBNTransactionStatsSchema.index({ networkType: 1, periodType: 1, date: -1 });
BBNTransactionStatsSchema.index({ periodType: 1, networkType: 1 });

export const BBNTransactionStats = mongoose.model('BBNTransactionStats', BBNTransactionStatsSchema); 