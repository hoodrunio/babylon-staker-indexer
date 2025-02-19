import mongoose from 'mongoose';
import { Network } from '../../types/finality';

interface VoteInfo {
    option: string;
    voting_power: string;
    vote_time: Date;
    tx_hash?: string;
    height?: number;
    is_validator: boolean;
}

interface VoteCounts {
    yes: string;
    no: string;
    abstain: string;
    no_with_veto: string;
}

const proposalVotesSchema = new mongoose.Schema({
    proposal_id: {
        type: Number,
        required: true,
        index: true
    },
    network: {
        type: String,
        required: true,
        enum: Object.values(Network),
        index: true
    },
    votes: {
        type: Map,
        of: new mongoose.Schema({
            option: {
                type: String,
                required: true,
                enum: ['YES', 'ABSTAIN', 'NO', 'VETO']
            },
            voting_power: {
                type: String,
                required: true
            },
            vote_time: {
                type: Date,
                required: true
            },
            tx_hash: {
                type: String,
                required: false
            },
            height: {
                type: Number,
                required: false
            },
            is_validator: {
                type: Boolean,
                required: true,
                default: false
            }
        }, { _id: false })
    },
    vote_counts: {
        type: {
            yes: {
                type: String,
                required: true,
                default: "0"
            },
            no: {
                type: String,
                required: true,
                default: "0"
            },
            abstain: {
                type: String,
                required: true,
                default: "0"
            },
            no_with_veto: {
                type: String,
                required: true,
                default: "0"
            }
        },
        required: true,
        _id: false
    },
    total_voting_power: {
        type: String,
        required: true,
        default: "0"
    },
    vote_count: {
        type: Number,
        required: true,
        default: 0
    }
}, {
    timestamps: true
});

// Compound index for network and proposal_id
proposalVotesSchema.index({ network: 1, proposal_id: 1 }, { unique: true });

// Helper method to update vote counts
proposalVotesSchema.methods.updateVoteCounts = function() {
    const votes = this.votes as Map<string, VoteInfo>;
    const voteCounts: VoteCounts = {
        yes: "0",
        no: "0",
        abstain: "0",
        no_with_veto: "0"
    };
    
    let totalPower = BigInt(0);
    
    for (const vote of votes.values()) {
        const optionKey = vote.option.toLowerCase() as keyof VoteCounts;
        // Increment vote count
        voteCounts[optionKey] = (BigInt(voteCounts[optionKey]) + BigInt(1)).toString();
        // Calculate total power for reference
        const votePower = BigInt(vote.voting_power.split('.')[0]);
        totalPower += votePower;
    }
    
    this.vote_counts = voteCounts;
    this.total_voting_power = totalPower.toString();
    this.vote_count = votes.size;
};

export const ProposalVotes = mongoose.model('ProposalVotes', proposalVotesSchema); 