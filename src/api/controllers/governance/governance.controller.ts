import { Request, Response } from 'express';
import { Proposal } from '../../../database/models/Proposal';
import { ProposalVotes } from '../../../database/models/ProposalVotes';
import { ValidatorInfo } from '../../../database/models/ValidatorInfo';
import { Network } from '../../../types/finality';
import { logger } from '../../../utils/logger';

export const getAllProposals = async (req: Request, res: Response) => {
    try {
        const network = req.network || Network.TESTNET;
        const status = req.query.status as string;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 100;

        const query: any = { network };
        if (status) {
            query.status = status;
        }

        const [proposals, total] = await Promise.all([
            Proposal.find(query)
                .sort({ proposal_id: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            Proposal.countDocuments(query)
        ]);

        res.json({
            proposals,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        logger.error('[API] Error fetching proposals:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getProposalById = async (req: Request, res: Response) => {
    try {
        const network = req.network || Network.TESTNET;
        const proposal = await Proposal.findOne({
            network,
            proposal_id: parseInt(req.params.id)
        });

        if (!proposal) {
            return res.status(404).json({ error: 'Proposal not found' });
        }

        res.json(proposal);
    } catch (error) {
        logger.error(`[API] Error fetching proposal ${req.params.id}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getProposalVotes = async (req: Request, res: Response) => {
    try {
        const network = req.network || Network.TESTNET;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 100;
        const option = req.query.option as string;
        const voterType = req.query.voter_type as 'validator' | 'user' | undefined;
        const proposalId = parseInt(req.params.id);

        const proposalVotes = await ProposalVotes.findOne({
            network,
            proposal_id: proposalId
        });

        if (!proposalVotes || !proposalVotes.votes) {
            return res.json({
                votes: [],
                stats: {
                    validator: { 
                        count: 0, 
                        voting_power: "0",
                        votes: {
                            yes: "0",
                            no: "0",
                            abstain: "0",
                            no_with_veto: "0"
                        }
                    },
                    user: { 
                        count: 0, 
                        voting_power: "0",
                        votes: {
                            yes: "0",
                            no: "0",
                            abstain: "0",
                            no_with_veto: "0"
                        }
                    }
                },
                pagination: {
                    total: 0,
                    page,
                    limit,
                    pages: 0
                }
            });
        }

        // Fetch all validators for the network (both active and inactive)
        const validators = await ValidatorInfo.find({ 
            network,
            account_address: { $exists: true, $ne: '' }
        }).select('account_address moniker logo_url valoper_address');
                
        // Create a map of validator details by account address
        const validatorMap = new Map();
        validators.forEach(v => {
            validatorMap.set(v.account_address, {
                moniker: v.moniker || 'Unknown Validator',
                logo_url: v.logo_url || '',
                valoper_address: v.valoper_address
            });
        });

        interface VoteData {
            option: string;
            voting_power: string;
            vote_time: Date;
            tx_hash?: string;
            height?: number;
            is_validator: boolean;
        }

        interface VoteWithVoter {
            voter: string;
            option: string;
            voting_power: string;
            vote_time: Date;
            tx_hash?: string;
            height?: number;
            is_validator: boolean;
            validator_info?: {
                moniker: string;
                logo_url: string;
                valoper_address: string;
            };
        }

        let votesArray = Array.from(proposalVotes.votes.entries()).map(([voter, vote]) => {
            const voteData = vote as VoteData;
            const validatorInfo = validatorMap.get(voter);
            
            // Update is_validator based on validatorInfo presence
            const isValidator = !!validatorInfo;

            return {
                voter,
                option: voteData.option,
                voting_power: voteData.voting_power,
                vote_time: voteData.vote_time,
                tx_hash: voteData.tx_hash,
                height: voteData.height,
                is_validator: isValidator,
                ...(validatorInfo && { validator_info: validatorInfo })
            } as VoteWithVoter;
        });

        if (option) {
            votesArray = votesArray.filter(vote => vote.option === option);
        }

        if (voterType === 'validator') {
            votesArray = votesArray.filter(vote => vote.validator_info);
        } else if (voterType === 'user') {
            votesArray = votesArray.filter(vote => !vote.validator_info);
        }

        votesArray.sort((a, b) => {
            const timeA = a.vote_time ? a.vote_time.getTime() : 0;
            const timeB = b.vote_time ? b.vote_time.getTime() : 0;
            return timeB - timeA;
        });

        const total = votesArray.length;
        const paginatedVotes = votesArray.slice((page - 1) * limit, page * limit);

        interface VoteStats {
            count: number;
            voting_power: string;
            votes: {
                yes: string;
                no: string;
                abstain: string;
                no_with_veto: string;
            };
        }

        const stats = votesArray.reduce((acc, vote) => {
            const group = vote.validator_info ? 'validator' : 'user';
            acc[group].count++;
            const votePower = BigInt(vote.voting_power.split('.')[0]);
            acc[group].voting_power = (BigInt(acc[group].voting_power) + votePower).toString();

            // Count votes by option
            const optionKey = vote.option.toLowerCase() as keyof VoteStats['votes'];
            acc[group].votes[optionKey] = (BigInt(acc[group].votes[optionKey]) + BigInt(1)).toString();

            return acc;
        }, {
            validator: { 
                count: 0, 
                voting_power: "0",
                votes: {
                    yes: "0",
                    no: "0",
                    abstain: "0",
                    no_with_veto: "0"
                }
            },
            user: { 
                count: 0, 
                voting_power: "0",
                votes: {
                    yes: "0",
                    no: "0",
                    abstain: "0",
                    no_with_veto: "0"
                }
            }
        });

        res.json({
            votes: paginatedVotes,
            stats,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        logger.error(`[API] Error fetching votes for proposal ${req.params.id}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getProposalStats = async (req: Request, res: Response) => {
    try {
        const network = req.network || Network.TESTNET;
        const proposalId = parseInt(req.params.id);

        const [proposal, proposalVotes] = await Promise.all([
            Proposal.findOne({ network, proposal_id: proposalId }),
            ProposalVotes.findOne({ network, proposal_id: proposalId })
        ]);

        if (!proposal) {
            return res.status(404).json({ error: 'Proposal not found' });
        }

        if (!proposalVotes) {
            return res.json({
                proposal_id: proposalId,
                total_votes: 0,
                vote_counts: {
                    yes: "0",
                    abstain: "0",
                    no: "0",
                    no_with_veto: "0"
                },
                total_voting_power: "0",
                final_tally: proposal.final_tally_result
            });
        }

        res.json({
            proposal_id: proposalId,
            total_votes: proposalVotes.vote_count,
            vote_counts: proposalVotes.vote_counts,
            total_voting_power: proposalVotes.total_voting_power,
            final_tally: proposal.final_tally_result
        });
    } catch (error) {
        logger.error(`[API] Error fetching stats for proposal ${req.params.id}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
}; 