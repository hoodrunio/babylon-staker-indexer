import mongoose from 'mongoose';

const newBTCDelegationSchema = new mongoose.Schema({
    stakingTxHex: { 
        type: String, 
        required: true, 
        unique: true 
    },
    stakingTxIdHex: {
        type: String,
        required: true,
        index: true
    },
    stakerAddress: { 
        type: String, 
        required: true,
        index: true 
    },
    stakerBtcAddress: {
        type: String,
        required: false,
        default: ''
    },
    stakerBtcPkHex: { 
        type: String, 
        required: true 
    },
    finalityProviderBtcPksHex: [{ 
        type: String, 
        required: true 
    }],
    stakingTime: { 
        type: Number, 
        required: true 
    },
    unbondingTime: { 
        type: Number, 
        required: true 
    },
    state: { 
        type: String, 
        required: true,
        enum: ['PENDING', 'VERIFIED', 'ACTIVE', 'UNBONDED'],
        index: true
    },
    networkType: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet'],
        index: true
    },
    totalSat: {
        type: Number,
        required: true
    },
    startHeight: {
        type: Number,
        required: true
    },
    endHeight: {
        type: Number
    },
    unbondingTxHex: {
        type: String
    },
    unbondingTxIdHex: {
        type: String,
        sparse: true,
        index: true
    },
    spendStakeTxHex: {
        type: String
    },
    spendStakeTxIdHex: {
        type: String,
        sparse: true,
        index: true
    },
    txHash: {
        type: String,
        required: true,
        index: true
    },
    blockHeight: {
        type: Number,
        required: true,
        index: true
    }
}, {
    timestamps: true,
    collection: 'new_btc_delegations'
});

// Compound indexes for common query patterns
newBTCDelegationSchema.index({ networkType: 1, state: 1 }); // For network and state based queries
newBTCDelegationSchema.index({ stakerAddress: 1, networkType: 1 }); // For staker based queries
newBTCDelegationSchema.index({ networkType: 1, totalSat: -1 }); // For amount based sorting
newBTCDelegationSchema.index({ networkType: 1, startHeight: -1 }); // For height based queries
newBTCDelegationSchema.index({ networkType: 1, createdAt: -1 }); // For time based queries
newBTCDelegationSchema.index({ networkType: 1, stakingTxIdHex: 1 }); // For transaction ID based queries

export const NewBTCDelegation = mongoose.model('NewBTCDelegation', newBTCDelegationSchema); 