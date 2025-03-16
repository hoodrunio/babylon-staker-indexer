import mongoose, { Document, Model } from 'mongoose';

// Signature information for each covenant member
export interface ICovenantMemberSignature {
    covenantBtcPkHex: string;
    signatureHex: string;
    state: 'PENDING' | 'SIGNED' | 'MISSED';
    signedAt?: Date;
}

// Signature collection for each transaction
export interface ICovenantSignature {
    stakingTxIdHex: string;
    txType: 'STAKING' | 'UNBONDING';
    networkType: 'mainnet' | 'testnet';
    blockHeight: number;
    signatures: ICovenantMemberSignature[];
    totalSignatures: number;
    signedCount: number;
    missedCount: number;
}

export interface ICovenantSignatureDocument extends ICovenantSignature, Document {
    markAsSigned(covenantBtcPkHex: string, signatureHex: string, blockHeight: number): Promise<void>;
    markAsMissed(covenantBtcPkHex: string): Promise<void>;
    updateCounts(): Promise<void>;
}

export interface ICovenantSignatureModel extends Model<ICovenantSignatureDocument> {
    findByStakingTx(networkType: string, stakingTxIdHex: string): Promise<ICovenantSignatureDocument | null>;
    findPendingSignatures(networkType: string, txType: string): Promise<ICovenantSignatureDocument[]>;
}

const covenantMemberSignatureSchema = new mongoose.Schema({
    covenantBtcPkHex: {
        type: String,
        required: true
    },
    signatureHex: {
        type: String,
        default: ''
    },
    state: {
        type: String,
        required: true,
        enum: ['PENDING', 'SIGNED', 'MISSED'],
        default: 'PENDING'
    },
    signedAt: {
        type: Date
    }
}, { _id: false });

const covenantSignatureSchema = new mongoose.Schema({
    stakingTxIdHex: {
        type: String,
        required: true,
        index: true
    },
    txType: {
        type: String,
        required: true,
        enum: ['STAKING', 'UNBONDING']
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
    signatures: [covenantMemberSignatureSchema],
    totalSignatures: {
        type: Number,
        required: true
    },
    signedCount: {
        type: Number,
        default: 0
    },
    missedCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
    collection: 'covenant_signatures'
});

// Compound indexes
covenantSignatureSchema.index({ networkType: 1, stakingTxIdHex: 1, txType: 1 }, { unique: true });
covenantSignatureSchema.index({ networkType: 1, blockHeight: -1 });

// Static methods
covenantSignatureSchema.statics.findByStakingTx = function(networkType: string, stakingTxIdHex: string): Promise<ICovenantSignatureDocument | null> {
    return this.findOne({ networkType, stakingTxIdHex });
};

covenantSignatureSchema.statics.findPendingSignatures = function(networkType: string, txType: string): Promise<ICovenantSignatureDocument[]> {
    return this.find({
        networkType,
        txType,
        'signatures.state': 'PENDING'
    });
};

// Instance methods
covenantSignatureSchema.methods.updateCounts = async function(this: ICovenantSignatureDocument): Promise<void> {
    const signed = this.signatures.filter(s => s.state === 'SIGNED').length;
    const missed = this.signatures.filter(s => s.state === 'MISSED').length;
    
    this.signedCount = signed;
    this.missedCount = missed;
    await this.save();
};

covenantSignatureSchema.methods.markAsSigned = async function(
    this: ICovenantSignatureDocument,
    covenantBtcPkHex: string,
    signatureHex: string,
    blockHeight: number
): Promise<void> {
    const signature = this.signatures.find(s => s.covenantBtcPkHex === covenantBtcPkHex);
    if (signature) {
        signature.state = 'SIGNED';
        signature.signatureHex = signatureHex;
        signature.signedAt = new Date();
        this.blockHeight = blockHeight;
        await this.updateCounts();
        await this.save();
    }
};

covenantSignatureSchema.methods.markAsMissed = async function(
    this: ICovenantSignatureDocument,
    covenantBtcPkHex: string
): Promise<void> {
    const signature = this.signatures.find(s => s.covenantBtcPkHex === covenantBtcPkHex);
    if (signature && signature.state === 'PENDING') {
        signature.state = 'MISSED';
        await this.updateCounts();
        await this.save();
    }
};

export const CovenantSignature = mongoose.model<ICovenantSignatureDocument, ICovenantSignatureModel>('CovenantSignature', covenantSignatureSchema); 