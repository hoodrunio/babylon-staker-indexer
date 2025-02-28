import mongoose from 'mongoose';

const BBNTransactionSchema = new mongoose.Schema({
    txHash: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    sender: { 
        type: String, 
        required: true, 
        index: true 
    },
    receiver: { 
        type: String, 
        required: true, 
        index: true 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    denom: { 
        type: String, 
        required: true 
    },
    type: { 
        type: String, 
        required: true, 
        enum: ['TRANSFER', 'STAKE', 'UNSTAKE', 'REWARD', 'OTHER'],
        index: true
    },
    networkType: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet'],
        index: true
    },
    blockHeight: { 
        type: Number, 
        required: true, 
        index: true 
    },
    timestamp: { 
        type: Number, 
        required: true, 
        index: true 
    },
    status: { 
        type: String, 
        required: true, 
        enum: ['SUCCESS', 'FAILED'],
        index: true
    },
    fee: { 
        type: Number, 
        required: true 
    },
    memo: { 
        type: String 
    }
}, {
    timestamps: true,
    collection: 'bbn_transactions'
});

// Compound indexes for common query patterns
BBNTransactionSchema.index({ networkType: 1, blockHeight: -1 });
BBNTransactionSchema.index({ networkType: 1, timestamp: -1 });
BBNTransactionSchema.index({ networkType: 1, type: 1, timestamp: -1 });
BBNTransactionSchema.index({ sender: 1, networkType: 1, timestamp: -1 });
BBNTransactionSchema.index({ receiver: 1, networkType: 1, timestamp: -1 });

export const BBNTransaction = mongoose.model('BBNTransaction', BBNTransactionSchema); 