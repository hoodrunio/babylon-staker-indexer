import mongoose from 'mongoose';
import { Network } from '../../types/finality';

// Interface for individual validator signature
interface IValidatorSignature {
    validator_address: string;  // valcons address
    hex_address: string;       // hex address
    validator_power: string;
    signed: boolean;
    vote_extension?: string;
    extension_signature?: string;
    moniker: string;
    valoper_address: string;
}

// Interface for participation statistics
interface IParticipationStats {
    total_validators: number;
    total_power: string;
    signed_power: string;
    unsigned_power: string;
    by_count: string;  // percentage as string (e.g. "93.00%")
    by_power: string;  // percentage as string (e.g. "94.89%")
}

// Interface for the whole document
interface IBLSValidatorSignatures {
    epoch_num: number;
    network: Network;
    signatures: IValidatorSignature[];
    stats: IParticipationStats;
    timestamp: number;
    updatedAt: Date;
}

// Schema for individual validator signature
const ValidatorSignatureSchema = new mongoose.Schema({
    validator_address: { type: String, required: true },  // valcons address
    hex_address: { type: String, required: true },       // hex address
    validator_power: { type: String, required: true },
    signed: { type: Boolean, required: true },
    vote_extension: { type: String },
    extension_signature: { type: String },
    moniker: { type: String, required: true },
    valoper_address: { type: String, required: true },
    timestamp: { type: Number, required: true }
}, { _id: false });

// Schema for participation statistics
const ParticipationStatsSchema = new mongoose.Schema({
    total_validators: { type: Number, required: true },
    total_power: { type: String, required: true },
    signed_power: { type: String, required: true },
    unsigned_power: { type: String, required: true },
    by_count: { type: String, required: true },
    by_power: { type: String, required: true }
}, { _id: false });

// Main schema
const BLSValidatorSignaturesSchema = new mongoose.Schema<IBLSValidatorSignatures>({
    epoch_num: { type: Number, required: true },
    network: { type: String, required: true, enum: Object.values(Network) },
    signatures: [ValidatorSignatureSchema],
    stats: { type: ParticipationStatsSchema, required: true },
    timestamp: { type: Number, required: true }
}, {
    timestamps: true,
    collection: 'bls_validator_signatures'
});

// Create compound index for epoch_num and network
BLSValidatorSignaturesSchema.index({ epoch_num: 1, network: 1 }, { unique: true });

export const BLSValidatorSignatures = mongoose.model<IBLSValidatorSignatures>('BLSValidatorSignatures', BLSValidatorSignaturesSchema); 