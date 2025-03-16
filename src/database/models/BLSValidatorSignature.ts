import mongoose from 'mongoose';

const blsValidatorSignatureSchema = new mongoose.Schema({
    epoch_num: {
        type: Number,
        required: true,
        index: true
    },
    validator_address: {
        type: String,
        required: true,
        index: true
    },
    validator_power: {
        type: String,
        required: true
    },
    signed: {
        type: Boolean,
        required: true,
        default: false,
        index: true
    },
    vote_extension: {
        type: String,
        required: false
    },
    extension_signature: {
        type: String,
        required: false
    },
    moniker: {
        type: String,
        required: false
    },
    valoper_address: {
        type: String,
        required: false
    },
    network: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet'],
        index: true
    }
}, {
    timestamps: true,
    collection: 'bls_validator_signatures'
});

// Compound indexes for common query patterns
blsValidatorSignatureSchema.index({ network: 1, epoch_num: 1 });
blsValidatorSignatureSchema.index({ network: 1, validator_address: 1, epoch_num: 1 }, { unique: true });
blsValidatorSignatureSchema.index({ network: 1, epoch_num: 1, signed: 1 }); // For querying signed/unsigned validators

export const BLSValidatorSignature = mongoose.model('BLSValidatorSignature', blsValidatorSignatureSchema); 