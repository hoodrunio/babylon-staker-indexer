import mongoose, { Document } from 'mongoose';
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

interface VoteStats {
    total_voting_power: string;
    vote_counts: VoteCounts;
    thresholds: {
        quorum: string;
        threshold: string;
        veto_threshold: string;
        expedited_threshold: string;
    };
    stats: {
        participation: string;
        yes_ratio: string;
        veto_ratio: string;
        quorum_reached: boolean;
        threshold_reached: boolean;
        veto_threshold_reached: boolean;
    };
}

interface IProposalVotes extends Document {
    proposal_id: number;
    network: Network;
    votes: Map<string, VoteInfo>;
    vote_counts: VoteCounts;
    total_voting_power: string;
    vote_count: number;
    updateVoteCounts(): void;
    getVotePercentages(): { [key: string]: string } | null;
    getVoteStats(): Promise<VoteStats | null>;
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
        
    for (const vote of votes.values()) {
        const optionKey = vote.option.toLowerCase() as keyof VoteCounts;
        const votePower = BigInt(vote.voting_power.split('.')[0]);
        
        // Add to vote counts based on voting power
        voteCounts[optionKey] = (BigInt(voteCounts[optionKey]) + votePower).toString();
    }
    
    this.vote_counts = voteCounts;
    this.vote_count = votes.size;
};

// Helper method to get vote percentages
proposalVotesSchema.methods.getVotePercentages = function() {
    const totalPower = BigInt(this.total_voting_power);
    if (totalPower === BigInt(0)) return null;

    const voteCounts = this.vote_counts;
    return {
        yes: ((BigInt(voteCounts.yes) * BigInt(100)) / totalPower).toString(),
        no: ((BigInt(voteCounts.no) * BigInt(100)) / totalPower).toString(),
        abstain: ((BigInt(voteCounts.abstain) * BigInt(100)) / totalPower).toString(),
        no_with_veto: ((BigInt(voteCounts.no_with_veto) * BigInt(100)) / totalPower).toString(),
    };
};

// Helper method to get vote percentages with thresholds
proposalVotesSchema.methods.getVoteStats = async function() {
    const totalPower = BigInt(this.total_voting_power);
    if (totalPower === BigInt(0)) return null;

    // Get governance params
    const params = await mongoose.model('GovernanceParams').findOne({ network: this.network });
    if (!params) {
        throw new Error('Governance parameters not found');
    }

    const voteCounts = this.vote_counts;
    const totalVoted = BigInt(voteCounts.yes) + BigInt(voteCounts.no) + BigInt(voteCounts.abstain) + BigInt(voteCounts.no_with_veto);
    
    // Calculate participation (quorum)
    const participation = totalVoted * BigInt(1000000) / totalPower;
    const quorumReached = participation >= BigInt(parseFloat(params.quorum) * 1000000);

    // Calculate yes ratio (excluding abstain)
    const totalNonAbstain = BigInt(voteCounts.yes) + BigInt(voteCounts.no) + BigInt(voteCounts.no_with_veto);
    const yesRatio = totalNonAbstain > 0 ? (BigInt(voteCounts.yes) * BigInt(1000000) / totalNonAbstain) : BigInt(0);
    
    // Calculate veto ratio
    const vetoRatio = totalVoted > 0 ? (BigInt(voteCounts.no_with_veto) * BigInt(1000000) / totalVoted) : BigInt(0);

    return {
        total_voting_power: this.total_voting_power,
        vote_counts: this.vote_counts,
        thresholds: {
            quorum: params.quorum,
            threshold: params.threshold,
            veto_threshold: params.veto_threshold,
            expedited_threshold: params.expedited_threshold
        },
        stats: {
            participation: (participation / BigInt(10000)).toString() + "%",
            yes_ratio: (yesRatio / BigInt(10000)).toString() + "%",
            veto_ratio: (vetoRatio / BigInt(10000)).toString() + "%",
            quorum_reached: quorumReached,
            threshold_reached: yesRatio >= BigInt(parseFloat(params.threshold) * 1000000),
            veto_threshold_reached: vetoRatio >= BigInt(parseFloat(params.veto_threshold) * 1000000)
        }
    };
};

export const ProposalVotes = mongoose.model<IProposalVotes>('ProposalVotes', proposalVotesSchema); 