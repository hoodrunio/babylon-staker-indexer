import mongoose from 'mongoose';
import { Network } from '../../types/finality';

const proposalSchema = new mongoose.Schema({
    proposal_id: {
        type: Number,
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    proposer: {
        type: String,
        required: true,
        index: true
    },
    status: {
        type: String,
        required: true,
        enum: ['PROPOSAL_STATUS_DEPOSIT_PERIOD', 'PROPOSAL_STATUS_VOTING_PERIOD', 'PROPOSAL_STATUS_PASSED', 'PROPOSAL_STATUS_REJECTED', 'PROPOSAL_STATUS_FAILED'],
        index: true
    },
    proposal_type: {
        type: [String],
        required: true,
        default: []
    },
    voting_start_time: {
        type: Date,
        required: true,
        index: true
    },
    voting_end_time: {
        type: Date,
        required: true,
        index: true
    },
    deposit_end_time: {
        type: Date,
        required: true
    },
    total_deposit: {
        type: String,
        required: true
    },
    network: {
        type: String,
        required: true,
        enum: Object.values(Network),
        index: true
    },
    final_tally_result: {
        yes: String,
        abstain: String,
        no: String,
        no_with_veto: String
    }
}, {
    timestamps: true
});

proposalSchema.index({ network: 1, proposal_id: 1 }, { unique: true });

export const Proposal = mongoose.model('Proposal', proposalSchema); 