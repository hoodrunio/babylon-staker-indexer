import mongoose from 'mongoose';

const BBNAccountSchema = new mongoose.Schema({
    address: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    balance: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    totalStaked: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    lastActivityTimestamp: { 
        type: Number, 
        required: true, 
        index: true 
    },
    lastActivityBlockHeight: { 
        type: Number, 
        required: true 
    },
    networkType: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet'],
        index: true
    },
    txCount: { 
        type: Number, 
        required: true, 
        default: 0 
    },
    isActive: { 
        type: Boolean, 
        required: true, 
        default: true, 
        index: true 
    },
    firstActivityTimestamp: { 
        type: Number, 
        required: true 
    }
}, {
    timestamps: true,
    collection: 'bbn_accounts'
});

// Compound indexes for common query patterns
BBNAccountSchema.index({ networkType: 1, isActive: 1 });
BBNAccountSchema.index({ networkType: 1, lastActivityTimestamp: -1 });
BBNAccountSchema.index({ networkType: 1, balance: -1 });
BBNAccountSchema.index({ networkType: 1, totalStaked: -1 });
BBNAccountSchema.index({ networkType: 1, txCount: -1 });

export const BBNAccount = mongoose.model('BBNAccount', BBNAccountSchema); 