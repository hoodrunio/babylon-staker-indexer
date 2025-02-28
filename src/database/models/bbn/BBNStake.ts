import mongoose from 'mongoose';

const BBNStakeSchema = new mongoose.Schema({
    txHash: { 
        type: String, 
        required: true, 
        index: true 
    },
    stakerAddress: { 
        type: String, 
        required: true, 
        index: true 
    },
    validatorAddress: { 
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
    startHeight: { 
        type: Number, 
        required: true 
    },
    startTimestamp: { 
        type: Number, 
        required: true, 
        index: true 
    },
    unbondingTime: { 
        type: Number 
    },
    endTimestamp: { 
        type: Number 
    },
    status: { 
        type: String, 
        required: true, 
        enum: ['ACTIVE', 'UNBONDING', 'UNBONDED'],
        index: true
    },
    networkType: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet'],
        index: true
    },
    unbondingTxHash: {
        type: String,
        index: true
    }
}, {
    timestamps: true,
    collection: 'bbn_stakes'
});

// Compound indexes for common query patterns
BBNStakeSchema.index({ networkType: 1, status: 1 });
BBNStakeSchema.index({ stakerAddress: 1, networkType: 1 });
BBNStakeSchema.index({ validatorAddress: 1, networkType: 1 });
BBNStakeSchema.index({ networkType: 1, startTimestamp: -1 });
BBNStakeSchema.index({ networkType: 1, amount: -1 });

export const BBNStake = mongoose.model('BBNStake', BBNStakeSchema); 