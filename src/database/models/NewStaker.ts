import mongoose from 'mongoose';

// Bir delegasyon için detaylı bilgileri içeren alt şema
const delegationDetailSchema = new mongoose.Schema({
    stakingTxIdHex: { 
        type: String, 
        required: true 
    },
    txHash: {
        type: String
    },
    finalityProviderBtcPkHex: { 
        type: String, 
        required: true 
    },
    totalSat: {
        type: Number,
        required: true
    },
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
        enum: ['PENDING', 'VERIFIED', 'ACTIVE', 'UNBONDED', 'EXPIRED']
    },
    networkType: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet']
    },
    paramsVersion: {
        type: Number
    },
    phase: {
        type: Number,
        default: 1
    },
    createdAt: {
        type: Date,
    },
    updatedAt: {
        type: Date,
    }
}, { _id: false });

// Phase bazlı istatistikler için alt şema
const phaseStatsSchema = new mongoose.Schema({
    phase: {
        type: Number,
        required: true
    },
    totalDelegations: {
        type: Number,
        default: 0
    },
    totalStakedSat: {
        type: Number,
        default: 0
    },
    activeDelegations: {
        type: Number,
        default: 0
    },
    activeStakedSat: {
        type: Number,
        default: 0
    },
    finalityProviders: [{
        btcPkHex: { type: String, required: true },
        delegationsCount: { type: Number, default: 0 },
        totalStakedSat: { type: Number, default: 0 }
    }]
}, { _id: false });

const newStakerSchema = new mongoose.Schema({
    // Staker'ın Babylon adresi (primary key)
    stakerAddress: { 
        type: String, 
        required: true, 
        unique: true,
        index: true 
    },
    // Staker'ın BTC adresi (opsiyonel)
    stakerBtcAddress: {
        type: String,
        required: false,
        default: ''
    },
    // Staker'ın BTC public key'i
    stakerBtcPkHex: { 
        type: String, 
        required: false 
    },
    // Staker'ın toplam aktif delegasyon sayısı
    activeDelegationsCount: {
        type: Number,
        default: 0
    },
    // Staker'ın toplam delegasyon sayısı (tüm durumlar)
    totalDelegationsCount: {
        type: Number,
        default: 0
    },
    // Staker'ın toplam stake edilmiş BTC miktarı (satoshi)
    totalStakedSat: {
        type: Number,
        default: 0
    },
    // Staker'ın aktif stake edilmiş BTC miktarı (satoshi)
    activeStakedSat: {
        type: Number,
        default: 0
    },
    // Staker'ın ilk delegasyon zamanı
    firstStakingTime: {
        type: Number
    },
    // Staker'ın son delegasyon zamanı
    lastStakingTime: {
        type: Number
    },
    // Staker'ın delegasyonlarının durumlarına göre sayıları
    delegationStates: {
        PENDING: { type: Number, default: 0 },
        VERIFIED: { type: Number, default: 0 },
        ACTIVE: { type: Number, default: 0 },
        UNBONDED: { type: Number, default: 0 },
        EXPIRED: { type: Number, default: 0 }
    },
    // Staker'ın ağ bazında delegasyon sayıları
    networkStats: {
        mainnet: {
            totalDelegations: { type: Number, default: 0 },
            activeDelegations: { type: Number, default: 0 },
            totalStakedSat: { type: Number, default: 0 },
            activeStakedSat: { type: Number, default: 0 }
        },
        testnet: {
            totalDelegations: { type: Number, default: 0 },
            activeDelegations: { type: Number, default: 0 },
            totalStakedSat: { type: Number, default: 0 },
            activeStakedSat: { type: Number, default: 0 }
        }
    },
    // Phase bazlı istatistikler
    phaseStats: [phaseStatsSchema],
    // Staker'ın kullandığı tüm finality provider'ların listesi
    uniqueFinalityProviders: [{
        btcPkHex: { type: String, required: true },
        delegationsCount: { type: Number, default: 0 },
        totalStakedSat: { type: Number, default: 0 }
    }],
    // Staker'ın tüm delegasyonlarının detayları
    delegations: [delegationDetailSchema],
    // Staker'ın son delegasyonlarının ID'leri (en son 10 delegasyon)
    recentDelegations: [{
        stakingTxIdHex: { type: String },
        txHash: { type: String },
        state: { type: String },
        networkType: { type: String },
        totalSat: { type: Number },
        stakingTime: { type: Number },
        createdAt: { type: Date },
        updatedAt: { type: Date }
    }],
    // Staker'ın son güncelleme zamanı
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'new_stakers'
});

// Compound indexes for common query patterns
newStakerSchema.index({ 'networkStats.mainnet.totalStakedSat': -1 }); // For mainnet amount based sorting
newStakerSchema.index({ 'networkStats.testnet.totalStakedSat': -1 }); // For testnet amount based sorting
newStakerSchema.index({ activeDelegationsCount: -1 }); // For active delegations count sorting
newStakerSchema.index({ totalDelegationsCount: -1 }); // For total delegations count sorting
newStakerSchema.index({ firstStakingTime: 1 }); // For first staking time sorting
newStakerSchema.index({ lastStakingTime: -1 }); // For last staking time sorting
newStakerSchema.index({ 'delegations.finalityProviderBtcPkHex': 1 }); // For finality provider based queries
newStakerSchema.index({ 'delegations.phase': 1 }); // For phase based queries

export const NewStaker = mongoose.model('NewStaker', newStakerSchema); 