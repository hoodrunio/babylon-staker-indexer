import mongoose from 'mongoose';

const blsCheckpointSchema = new mongoose.Schema({
    epoch_num: {
        type: Number,
        required: true,
        unique: true,
        index: true
    },
    block_hash: {
        type: String,
        required: true
    },
    bitmap: {
        type: String,
        required: true
    },
    bls_multi_sig: {
        type: String,
        required: true
    },
    status: {
        type: String,
        required: true,
        enum: ['CKPT_STATUS_ACCUMULATING', 'CKPT_STATUS_SEALED', 'CKPT_STATUS_SUBMITTED', 'CKPT_STATUS_CONFIRMED', 'CKPT_STATUS_FINALIZED'],
        index: true
    },
    bls_aggr_pk: {
        type: String,
        required: true
    },
    power_sum: {
        type: String,
        required: true
    },
    lifecycle: [{
        state: {
            type: String,
            required: true,
            enum: ['CKPT_STATUS_ACCUMULATING', 'CKPT_STATUS_SEALED', 'CKPT_STATUS_SUBMITTED', 'CKPT_STATUS_CONFIRMED', 'CKPT_STATUS_FINALIZED']
        },
        block_height: {
            type: Number,
            required: true
        },
        block_time: {
            type: Date,
            required: true
        }
    }],
    network: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet'],
        index: true
    },
    timestamp: {
        type: Number,
        required: true
    }
}, {
    timestamps: true,
    collection: 'bls_checkpoints'
});

// Compound indexes for common query patterns
blsCheckpointSchema.index({ network: 1, status: 1 });
blsCheckpointSchema.index({ network: 1, epoch_num: -1 });
blsCheckpointSchema.index({ network: 1, createdAt: -1 });

export const BLSCheckpoint = mongoose.model('BLSCheckpoint', blsCheckpointSchema); 