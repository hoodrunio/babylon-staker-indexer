import { BabylonClient } from '../../clients/BabylonClient';
import { Proposal } from '../../database/models/Proposal';
import { ProposalVotes } from '../../database/models/ProposalVotes';
import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { ValidatorInfoService } from '../../services/validator/ValidatorInfoService';
import { ProposalMessageParser } from '../../utils/proposal-message-parser';
import { GovernanceParams } from '../../database/models/GovernanceParams';

export class GovernanceIndexerService {
    private babylonClient: BabylonClient;
    private isRunning = false;
    private networks: Network[] = [];
    private shouldSync: boolean;

    constructor(babylonClient: BabylonClient) {
        this.babylonClient = babylonClient;
        this.shouldSync = process.env.GOVERNANCE_SYNC === 'true';
        
        // Initialize networks based on environment variables
        if (process.env.BABYLON_NODE_URL && process.env.BABYLON_RPC_URL) {
            this.networks.push(Network.MAINNET);
        }
        if (process.env.BABYLON_TESTNET_NODE_URL && process.env.BABYLON_TESTNET_RPC_URL) {
            this.networks.push(Network.TESTNET);
        }

        if (this.networks.length === 0) {
            throw new Error('No network configuration found in environment variables');
        }
    }

    public async start() {
        if (this.isRunning) {
            logger.warn('[Governance] Indexer is already running');
            return;
        }

        this.isRunning = true;
        
        // If shouldSync is true, do initial sync for all networks
        if (this.shouldSync) {
            logger.info('[Governance] Starting initial sync for all networks');
            for (const network of this.networks) {
                try {
                    // First update governance parameters
                    await this.updateGovernanceParams(network, this.babylonClient);
                    logger.info(`[Governance] Updated governance parameters for network ${network}`);

                    // Then sync proposals
                    await this.indexProposals(network);
                    logger.info(`[Governance] Completed initial sync for network ${network}`);
                } catch (error) {
                    logger.error(`[Governance] Error in initial sync for network ${network}:`, error);
                }
            }
            logger.info('[Governance] Initial sync completed for all networks');
        } else {
            logger.info('[Governance] Skipping initial sync, will rely on WebSocket updates');
        }
    }

    public stop() {
        this.isRunning = false;
    }

    private async indexProposals(network: Network) {
        // Get the appropriate BabylonClient instance for the network
        const client = BabylonClient.getInstance(network);
        const proposals = await client.getProposals();

        logger.info(`[Governance] Found ${proposals.length} proposals for network ${network}`);
        for (const proposal of proposals) {
            try {
                await this.updateProposalAndVotes(proposal, network);
            } catch (error) {
                logger.error(`[Governance] Error processing proposal ${proposal.id} for network ${network}:`, error);
            }
        }
    }

    private async updateProposalAndVotes(proposal: any, network: Network) {
        const client = BabylonClient.getInstance(network);
        
        // Always update governance parameters
        await this.updateGovernanceParams(network, client);

        // Process messages using the ProposalMessageParser
        const messages = proposal.messages?.map((msg: any) => ProposalMessageParser.parseMessage(msg)) || [];

        // Get existing proposal to check if status has changed
        const existingProposal = await Proposal.findOne({
            network,
            proposal_id: proposal.id
        });

        // Update or create proposal
        await Proposal.findOneAndUpdate(
            {
                network,
                proposal_id: proposal.id
            },
            {
                title: proposal.title,
                description: proposal.summary,
                proposer: proposal.proposer,
                status: proposal.status,
                proposal_type: proposal.messages?.map((msg: any) => msg['@type']) || [],
                messages,
                voting_start_time: new Date(proposal.voting_start_time),
                voting_end_time: new Date(proposal.voting_end_time),
                deposit_end_time: new Date(proposal.deposit_end_time),
                total_deposit: proposal.total_deposit?.[0]?.amount || '0',
                network,
                final_tally_result: {
                    yes: proposal.final_tally_result?.yes_count || "0",
                    abstain: proposal.final_tally_result?.abstain_count || "0",
                    no: proposal.final_tally_result?.no_count || "0",
                    no_with_veto: proposal.final_tally_result?.no_with_veto_count || "0"
                },
                metadata: proposal.metadata || '',
                expedited: proposal.expedited || false,
                failed_reason: proposal.failed_reason || ''
            },
            { upsert: true, new: true }
        );

        // Only fetch votes if proposal is in voting period or completed
        if (proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD') {
            await this.updateProposalVotesFromTxs(proposal.id, network, client);
        } else if (proposal.status === 'PROPOSAL_STATUS_PASSED' || proposal.status === 'PROPOSAL_STATUS_REJECTED') {
            logger.info(`[Governance] Processing completed proposal ${proposal.id} with status ${proposal.status}`);
            // For completed proposals, directly use tx search
            await this.updateProposalVotesFromTxs(proposal.id, network, client);
        }
    }

    private async updateProposalVotes(proposalId: string | number, network: Network, client: BabylonClient) {
        const votes = await client.getProposalVotes(parseInt(proposalId.toString()));
        await this.processVotes(proposalId, network, votes);
    }

    private async updateProposalVotesFromTxs(proposalId: string | number, network: Network, client: BabylonClient) {
        let page = 1;
        const limit = 100;
        let hasMore = true;
        const processedVotes: any[] = [];

        while (hasMore) {
            logger.info(`[Governance] Fetching votes from transactions for proposal ${proposalId}, page ${page}`);
            const query = `proposal_vote.proposal_id=${proposalId}`;
            const txsResponse = await client.searchTxs(query, page, limit);
            
            if (!txsResponse || !txsResponse.tx_responses || txsResponse.tx_responses.length === 0) {
                logger.info(`[Governance] No more transactions found for proposal ${proposalId}`);
                hasMore = false;
                break;
            }

            logger.info(`[Governance] Processing ${txsResponse.tx_responses.length} transactions for proposal ${proposalId}`);
            for (const txResponse of txsResponse.tx_responses) {
                if (txResponse.events) {
                    const voteEvents = txResponse.events.filter((event: any) => event.type === 'proposal_vote');
                    for (const voteEvent of voteEvents) {
                        const attributes = voteEvent.attributes || [];
                        const voterAttr = attributes.find((attr: any) => attr.key === 'voter');
                        const optionAttr = attributes.find((attr: any) => attr.key === 'option');
                        const proposalIdAttr = attributes.find((attr: any) => attr.key === 'proposal_id');
                        
                        if (voterAttr && optionAttr && proposalIdAttr && 
                            proposalIdAttr.value === proposalId.toString()) {
                            try {
                                const optionData = JSON.parse(optionAttr.value);
                                const optionValue = parseInt(optionData[0].option);
                                const optionMap: { [key: number]: string } = {
                                    1: 'YES',
                                    2: 'ABSTAIN',
                                    3: 'NO',
                                    4: 'VETO'
                                };
                                
                                processedVotes.push({
                                    proposal_id: proposalId,
                                    voter: voterAttr.value,
                                    options: [{
                                        option: optionMap[optionValue],
                                        weight: optionData[0].weight || "1.000000000000000000"
                                    }],
                                    tx_hash: txResponse.txhash,
                                    vote_time: new Date(txResponse.timestamp)
                                });
                            } catch (error) {
                                logger.error(`[Governance] Error parsing vote option from tx for proposal ${proposalId}:`, error);
                            }
                        }
                    }
                }
            }

            if (txsResponse.total) {
                const total = parseInt(txsResponse.total);
                const processed = page * limit;
                logger.info(`[Governance] Processed ${processed}/${total} transactions for proposal ${proposalId}`);
                
                if (processed >= total) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else {
                hasMore = false;
            }
        }

        if (processedVotes.length > 0) {
            logger.info(`[Governance] Found ${processedVotes.length} votes from transactions for proposal ${proposalId}`);
            await this.processVotes(proposalId, network, processedVotes);
        } else {
            logger.warn(`[Governance] No votes found in transactions for proposal ${proposalId}`);
        }
    }

    private async processVotes(proposalId: string | number, network: Network, votes: any[]) {
        let proposalVotes = await ProposalVotes.findOne({
            network,
            proposal_id: parseInt(proposalId.toString())
        });

        // Get validator info service instance
        const validatorInfoService = ValidatorInfoService.getInstance();

        // Calculate total voting power from all active validators
        let totalVotingPower = "0";
        try {
            const allValidators = await validatorInfoService.getAllValidators(network, false);
            totalVotingPower = allValidators.validators.reduce((acc, validator) => {
                if (validator.active && validator.voting_power) {
                    const currentPower = BigInt(validator.voting_power);
                    return (BigInt(acc) + currentPower).toString();
                }
                return acc;
            }, "0");
            logger.info(`[Governance] Total voting power from all active validators: ${totalVotingPower}`);
        } catch (error) {
            logger.error(`[Governance] Error calculating total voting power: ${error}`);
        }

        if (!proposalVotes) {
            proposalVotes = new ProposalVotes({
                network,
                proposal_id: parseInt(proposalId.toString()),
                votes: new Map(),
                vote_counts: {
                    yes: "0",
                    abstain: "0",
                    no: "0",
                    no_with_veto: "0"
                },
                total_voting_power: totalVotingPower,
                vote_count: 0
            });
        } else {
            // Update total voting power for existing proposal votes
            proposalVotes.total_voting_power = totalVotingPower;
        }

        // Ensure votes map exists
        if (!proposalVotes.votes) {
            proposalVotes.votes = new Map();
        }

        // Sort votes by timestamp to ensure latest vote is processed last
        votes.sort((a, b) => {
            const aTime = new Date(a.vote_time || 0).getTime();
            const bTime = new Date(b.vote_time || 0).getTime();
            return aTime - bTime;
        });

        // Track processed votes for logging
        const processedVoters = new Set<string>();
        const updatedVotes = new Set<string>();

        // Update votes
        for (const vote of votes) {
            if (!vote.options || vote.options.length === 0) {
                logger.warn(`[Governance] Vote without options for proposal ${proposalId} from ${vote.voter}`);
                continue;
            }

            const voteOption = vote.options[0];
            const existingVote = proposalVotes.votes.get(vote.voter);
            
            // Skip if vote already exists and has the same option
            if (existingVote && existingVote.option === voteOption.option) {
                continue;
            }

            // Check if the voter is a validator
            let votingPower = voteOption.weight || "1.000000000000000000";
            let validatorInfo = null;
            try {
                validatorInfo = await validatorInfoService.getValidatorByAccountAddress(vote.voter, network);
                if (validatorInfo && validatorInfo.active && validatorInfo.voting_power) {
                    votingPower = validatorInfo.voting_power;
                    logger.debug(`[Governance] Using validator voting power ${votingPower} for voter ${vote.voter}`);
                }
            } catch (error) {
                logger.warn(`[Governance] Error checking validator status for voter ${vote.voter}:`, error);
            }
            
            proposalVotes.votes.set(vote.voter, {
                option: voteOption.option,
                voting_power: votingPower,
                vote_time: vote.vote_time,
                tx_hash: vote.tx_hash,
                is_validator: validatorInfo?.active || false
            });

            if (!processedVoters.has(vote.voter)) {
                processedVoters.add(vote.voter);
            } else {
                updatedVotes.add(vote.voter);
            }
        }

        // Log summary instead of individual votes
        logger.info(`[Governance] Processing ${processedVoters.size} unique votes for proposal ${proposalId}`);
        if (updatedVotes.size > 0) {
            logger.info(`[Governance] ${updatedVotes.size} voters updated their votes`);
        }

        // Update vote counts
        try {
            (proposalVotes as any).updateVoteCounts();
            await proposalVotes.save();
            logger.info(`[Governance] Successfully updated votes for proposal ${proposalId}`);
            logger.info(`[Governance] Final vote counts: Yes=${proposalVotes.vote_counts.yes}, No=${proposalVotes.vote_counts.no}, Abstain=${proposalVotes.vote_counts.abstain}, NoWithVeto=${proposalVotes.vote_counts.no_with_veto}`);
            logger.info(`[Governance] Total voting power: ${proposalVotes.total_voting_power}`);
        } catch (error) {
            logger.error(`[Governance] Error updating vote counts for proposal ${proposalId}:`, error);
            throw error;
        }
    }

    private async updateGovernanceParams(network: Network, client: BabylonClient) {
        try {
            const params = await client.getGovernanceParams();
            
            if (!params) {
                logger.warn(`[Governance] No governance parameters found for network ${network}`);
                return;
            }

            await GovernanceParams.findOneAndUpdate(
                { network },
                {
                    quorum: params.params?.quorum || params.tally_params?.quorum,
                    threshold: params.params?.threshold || params.tally_params?.threshold,
                    veto_threshold: params.params?.veto_threshold || params.tally_params?.veto_threshold,
                    expedited_threshold: params.params?.expedited_threshold,
                    min_deposit: params.params?.min_deposit,
                    expedited_min_deposit: params.params?.expedited_min_deposit,
                    voting_period: params.params?.voting_period,
                    expedited_voting_period: params.params?.expedited_voting_period,
                    burn_vote_quorum: params.params?.burn_vote_quorum,
                    burn_proposal_deposit_prevote: params.params?.burn_proposal_deposit_prevote,
                    burn_vote_veto: params.params?.burn_vote_veto,
                    last_updated: new Date()
                },
                { upsert: true, new: true }
            );

            logger.info(`[Governance] Updated governance parameters for network ${network}`);
        } catch (error) {
            logger.error(`[Governance] Error updating governance parameters for network ${network}:`, error);
        }
    }
} 