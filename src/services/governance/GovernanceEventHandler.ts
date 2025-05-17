import { logger } from '../../utils/logger';
import { ProposalVotes } from '../../database/models/ProposalVotes';
import { Proposal } from '../../database/models/Proposal';
import { BabylonClient } from '../../clients/BabylonClient';
import { ValidatorInfoService } from '../validator/ValidatorInfoService';

export class GovernanceEventHandler {
    private static instance: GovernanceEventHandler | null = null;

    private constructor() {}

    public static getInstance(): GovernanceEventHandler {
        if (!GovernanceEventHandler.instance) {
            GovernanceEventHandler.instance = new GovernanceEventHandler();
        }
        return GovernanceEventHandler.instance;
    }

    public async handleEvent(txData: any): Promise<void> {
        const network = BabylonClient.getInstance().getNetwork();
        try {
            const events = txData.events;
            
            // Handle vote events
            if (events.some((event: any) => event.type === 'proposal_vote')) {
                await this.handleVoteEvent(events);
            }

            // Handle proposal submission events
            if (events.some((event: any) => event.type === 'submit_proposal')) {
                await this.handleProposalSubmission(events);
            }

            // Handle proposal status change events
            if (events.some((event: any) => event.type === 'proposal_status')) {
                await this.handleProposalStatusChange(events);
            }
        } catch (error) {
            logger.error('[Governance] Error handling event:', error);
        }
    }

    private async handleVoteEvent(events: any): Promise<void> {
        const network = BabylonClient.getInstance().getNetwork();
        try {
            const voteEvent = events.find((event: any) => event.type === 'proposal_vote');
            if (!voteEvent?.attributes) return;

            // Parse vote attributes
            const proposalId = this.findAttributeValue(voteEvent.attributes, 'proposal_id');
            const voter = this.findAttributeValue(voteEvent.attributes, 'voter');
            const optionStr = this.findAttributeValue(voteEvent.attributes, 'option');

            // Get tx hash and height from events
            const txHash = events.events?.['tx.hash']?.[0] || null;
            const height = events.events?.['tx.height']?.[0] || null;

            if (!proposalId || !voter || !optionStr) {
                logger.warn('[Governance] Missing vote event attributes:', { proposalId, voter, optionStr });
                return;
            }

            // Parse option JSON
            let voteOption: string;
            let voteWeight: string;
            try {
                const optionData = JSON.parse(optionStr);
                const optionMap: { [key: number]: string } = {
                    1: 'YES',
                    2: 'ABSTAIN',
                    3: 'NO',
                    4: 'VETO'
                };
                voteOption = optionMap[optionData[0].option] || 'UNSPECIFIED';
                voteWeight = optionData[0].weight || '1.000000000000000000';
            } catch (error) {
                logger.error('[Governance] Error parsing vote option:', error);
                return;
            }

            // Get or create proposal votes document
            let proposalVotes = await ProposalVotes.findOne({
                network,
                proposal_id: parseInt(proposalId)
            });

            if (!proposalVotes) {
                proposalVotes = new ProposalVotes({
                    network,
                    proposal_id: parseInt(proposalId),
                    votes: new Map(),
                    vote_counts: {
                        yes: "0",
                        abstain: "0",
                        no: "0",
                        no_with_veto: "0"
                    },
                    total_voting_power: "0",
                    vote_count: 0
                });
            }

            // Ensure votes map exists
            if (!proposalVotes.votes) {
                proposalVotes.votes = new Map();
            }

            // Get validator info for voting power
            let votingPower = voteWeight;
            let isValidator = false;
            try {
                const validatorInfoService = ValidatorInfoService.getInstance();
                const validator = await validatorInfoService.getValidatorByAccountAddress(voter);
                if (validator && validator.active) {
                    isValidator = true;
                    if (validator.voting_power) {
                        votingPower = validator.voting_power;
                    }
                }
            } catch (error) {
                logger.warn(`[Governance] Error checking validator status for voter ${voter}, using default weight:`, error);
            }

            // Create vote info object
            const voteInfo = {
                option: voteOption,
                voting_power: votingPower,
                vote_time: new Date(),
                tx_hash: txHash,
                height: height ? parseInt(height) : undefined,
                is_validator: isValidator
            };

            // Update vote
            proposalVotes.votes.set(voter, voteInfo);

            // Update vote counts
            (proposalVotes as any).updateVoteCounts();
            await proposalVotes.save();

            logger.debug(`[Governance] Recorded vote for proposal ${proposalId} from ${voter} with option ${voteOption}${txHash ? ` (tx: ${txHash})` : ''}`);
        } catch (error) {
            logger.error('[Governance] Error handling vote event:', error);
        }
    }

    private async handleProposalSubmission(events: any[]): Promise<void> {
        const network = BabylonClient.getInstance().getNetwork();
        try {
            const submitEvent = events.find(event => event.type === 'submit_proposal');
            if (!submitEvent?.attributes) return;

            const proposalId = this.findAttributeValue(submitEvent.attributes, 'proposal_id');
            if (!proposalId) {
                logger.warn('[Governance] Missing proposal_id in submission event');
                return;
            }

            // Fetch full proposal details and update database
            const proposal = await this.fetchProposalDetails(parseInt(proposalId));
            if (proposal) {
                await this.updateProposal(proposal);
                logger.info(`[Governance] Recorded new proposal ${proposalId}`);
            }
        } catch (error) {
            logger.error('[Governance] Error handling proposal submission:', error);
        }
    }

    private async handleProposalStatusChange(events: any[]): Promise<void> {
        const network = BabylonClient.getInstance().getNetwork();
        try {
            const statusEvent = events.find(event => event.type === 'proposal_status');
            if (!statusEvent?.attributes) return;

            const proposalId = this.findAttributeValue(statusEvent.attributes, 'proposal_id');
            const status = this.findAttributeValue(statusEvent.attributes, 'status');

            if (!proposalId || !status) {
                logger.warn('[Governance] Missing status event attributes:', { proposalId, status });
                return;
            }

            // Update proposal status
            await Proposal.findOneAndUpdate(
                {
                    network,
                    proposal_id: parseInt(proposalId)
                },
                {
                    status
                }
            );

            logger.info(`[Governance] Updated proposal ${proposalId} status to ${status}`);
        } catch (error) {
            logger.error('[Governance] Error handling proposal status change:', error);
        }
    }

    private findAttributeValue(attributes: any[], key: string): string | null {
        const attribute = attributes.find(attr => attr.key === key);
        return attribute ? attribute.value : null;
    }

    private async fetchProposalDetails(proposalId: number): Promise<any> {
        try {
            const client = BabylonClient.getInstance();
            return await client.getProposalDetails(proposalId);
        } catch (error) {
            logger.error(`[Governance] Error fetching proposal ${proposalId}:`, error);
            return null;
        }
    }

    private async updateProposal(proposalData: any): Promise<void> {
        const network = BabylonClient.getInstance().getNetwork();
        try {
            await Proposal.findOneAndUpdate(
                {
                    network,
                    proposal_id: proposalData.id
                },
                {
                    title: proposalData.title,
                    description: proposalData.summary,
                    proposer: proposalData.proposer,
                    status: proposalData.status,
                    proposal_type: proposalData.messages?.map((msg: any) => msg['@type']) || [],
                    voting_start_time: new Date(proposalData.voting_start_time),
                    voting_end_time: new Date(proposalData.voting_end_time),
                    deposit_end_time: new Date(proposalData.deposit_end_time),
                    total_deposit: proposalData.total_deposit?.[0]?.amount || '0',
                    network,
                    final_tally_result: {
                        yes: proposalData.final_tally_result?.yes_count || "0",
                        abstain: proposalData.final_tally_result?.abstain_count || "0",
                        no: proposalData.final_tally_result?.no_count || "0",
                        no_with_veto: proposalData.final_tally_result?.no_with_veto_count || "0"
                    }
                },
                { upsert: true, new: true }
            );
        } catch (error) {
            logger.error(`[Governance] Error updating proposal:`, error);
        }
    }
} 