import mongoose, { Document, Model } from 'mongoose';
import { Network } from '../../types/finality';

// Signature details for each block
export interface BlockSignatureDetail {
    blockHeight: number;
    signed: boolean;
    round: number;
    timestamp: Date;
}

export interface MissedBlock {
    blockHeight: number;
    timestamp: Date;
}

export interface IValidatorSignature {
    validatorAddress: string;
    validatorMoniker?: string;
    validatorConsensusAddress?: string;
    validatorOperatorAddress?: string;
    network: string;
    totalSignedBlocks: number;
    totalBlocksInWindow: number;
    lastSignedBlock: number;
    lastSignedBlockTime?: Date;
    recentBlocks: BlockSignatureDetail[];
    signatureRate: number;
    consecutiveSigned: number;
    consecutiveMissed: number;
}

export interface IValidatorSignatureDocument extends IValidatorSignature, Document {
    addBlock(block: BlockSignatureDetail): Promise<void>;
}

export interface IValidatorSignatureModel extends Model<IValidatorSignatureDocument> {
    findByAddress(network: string, address: string): Promise<IValidatorSignatureDocument | null>;
}

const validatorSignatureSchema = new mongoose.Schema({
    validatorAddress: {
        type: String,
        required: true,
        index: true
    },
    validatorMoniker: {
        type: String,
        required: false
    },
    validatorConsensusAddress: {
        type: String,
        required: false,
        index: true
    },
    validatorOperatorAddress: {
        type: String,
        required: false,
        index: true
    },
    network: {
        type: String,
        required: true,
        enum: ['mainnet', 'testnet'],
        index: true
    },
    totalSignedBlocks: {
        type: Number,
        default: 0
    },
    totalBlocksInWindow: {
        type: Number,
        default: 0
    },
    lastSignedBlock: {
        type: Number,
        default: 0
    },
    lastSignedBlockTime: {
        type: Date
    },
    recentBlocks: [{
        blockHeight: {
            type: Number,
            required: true
        },
        signed: {
            type: Boolean,
            required: true
        },
        round: {
            type: Number,
            required: true
        },
        timestamp: {
            type: Date,
            required: true
        }
    }],
    signatureRate: {
        type: Number,
        default: 100
    },
    consecutiveSigned: {
        type: Number,
        default: 0
    },
    consecutiveMissed: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
    collection: 'validator_signatures'
});

// Compound indexes
validatorSignatureSchema.index({ network: 1, validatorAddress: 1 }, { unique: true });
validatorSignatureSchema.index({ network: 1, validatorConsensusAddress: 1 });
validatorSignatureSchema.index({ network: 1, validatorOperatorAddress: 1 });
validatorSignatureSchema.index({ network: 1, signatureRate: -1 });

// Static methods
validatorSignatureSchema.statics.findByAddress = function(network: string, address: string): Promise<IValidatorSignatureDocument | null> {
    return this.findOne({ network, validatorAddress: address });
};

// Instance methods
validatorSignatureSchema.methods.addBlock = async function(this: IValidatorSignatureDocument, block: BlockSignatureDetail): Promise<void> {
    this.recentBlocks.push(block);
    if (this.recentBlocks.length > 1000) {
        this.recentBlocks.shift();
    }

    if (block.signed) {
        this.totalSignedBlocks += 1;
        this.totalBlocksInWindow += 1;
        this.lastSignedBlock = block.blockHeight;
        this.lastSignedBlockTime = block.timestamp;
        this.consecutiveSigned += 1;
        this.consecutiveMissed = 0;
    } else {
        this.consecutiveMissed += 1;
        this.consecutiveSigned = 0;
    }

    // Update signature ratio
    const totalBlocks = this.recentBlocks.length;
    const signedBlocks = this.recentBlocks.filter(b => b.signed).length;
    this.signatureRate = totalBlocks > 0 ? (signedBlocks / totalBlocks) * 100 : 0;

    await this.save();
};

export const ValidatorSignature = mongoose.model<IValidatorSignatureDocument, IValidatorSignatureModel>('ValidatorSignature', validatorSignatureSchema); 