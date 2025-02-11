import mongoose from 'mongoose';

const validatorInfoSchema = new mongoose.Schema({
    hex_address: {
        type: String,
        required: true,
        index: true,
        match: /^[0-9A-F]{40}$/
    },
    consensus_pubkey: {
        type: String,
        required: true,
        index: true
    },
    consensus_hex_address: {
        type: String,
        required: true,
        index: true,
        match: /^[0-9A-F]{40}$/
    },
    valoper_address: {
        type: String,
        required: true,
        index: true,
        match: /^bbnvaloper1[a-zA-Z0-9]{38}$/
    },
    moniker: {
        type: String,
        required: true,
        trim: true
    },
    website: {
        type: String,
        trim: true
    },
    details: {
        type: String,
        trim: true
    },
    voting_power: {
        type: String,
        required: true,
        default: '0',
        validate: {
            validator: function(v: string) {
                return /^\d+$/.test(v);
            },
            message: 'Voting power must be a numeric string'
        }
    },
    network: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet'],
        index: true
    },
    active: {
        type: Boolean,
        required: true,
        default: true,
        index: true
    },
    last_seen: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    finality_provider_btc_pk_hex: {
        type: String,
        index: true,
        sparse: true
    },
    is_finality_provider: {
        type: Boolean,
        required: true,
        default: false,
        index: true
    },
    matched_by: {
        type: String,
        enum: ['moniker', 'website', 'identity', 'security_contact', null],
        default: null
    }
}, {
    timestamps: true,
    collection: 'validator_info'
});

// Compound indexes
validatorInfoSchema.index({ network: 1, hex_address: 1 }, { unique: true });
validatorInfoSchema.index({ network: 1, consensus_hex_address: 1 }, { unique: true });
validatorInfoSchema.index({ network: 1, valoper_address: 1 }, { unique: true });
validatorInfoSchema.index({ network: 1, voting_power: -1 }); // For sorting by voting power
validatorInfoSchema.index({ network: 1, last_seen: -1 }); // For querying recently active validators

export const ValidatorInfo = mongoose.model('ValidatorInfo', validatorInfoSchema); 