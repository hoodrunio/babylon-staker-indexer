import mongoose from 'mongoose';
import { Network } from '../../types/finality';

const governanceParamsSchema = new mongoose.Schema({
    network: {
        type: String,
        required: true,
        enum: Object.values(Network),
        index: true,
        unique: true
    },
    quorum: {
        type: String,
        required: true
    },
    threshold: {
        type: String,
        required: true
    },
    veto_threshold: {
        type: String,
        required: true
    },
    expedited_threshold: {
        type: String,
        required: true
    },
    min_deposit: [{
        denom: {
            type: String,
            required: true
        },
        amount: {
            type: String,
            required: true
        }
    }],
    expedited_min_deposit: [{
        denom: {
            type: String,
            required: true
        },
        amount: {
            type: String,
            required: true
        }
    }],
    voting_period: {
        type: String,
        required: true
    },
    expedited_voting_period: {
        type: String,
        required: true
    },
    burn_vote_quorum: {
        type: Boolean,
        required: true,
        default: false
    },
    burn_proposal_deposit_prevote: {
        type: Boolean,
        required: true,
        default: false
    },
    burn_vote_veto: {
        type: Boolean,
        required: true,
        default: true
    },
    last_updated: {
        type: Date,
        required: true,
        default: Date.now
    }
});

export const GovernanceParams = mongoose.model('GovernanceParams', governanceParamsSchema); 