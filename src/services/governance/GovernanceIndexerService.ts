import { BabylonClient } from '../../clients/BabylonClient';
import { Proposal } from '../../database/models/Proposal';
import { ProposalVotes } from '../../database/models/ProposalVotes';
import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { ValidatorInfoService } from '../../services/validator/ValidatorInfoService';

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
                }
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
                total_voting_power: "0",
                vote_count: 0
            });
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

        // Get validator info service instance
        const validatorInfoService = ValidatorInfoService.getInstance();

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
            let isValidator = false;
            try {
                const validator = await validatorInfoService.getValidatorByAccountAddress(vote.voter, network);
                if (validator && validator.active) {
                    isValidator = true;
                    if (validator.voting_power) {
                        votingPower = validator.voting_power;
                    }
                } else {
                    logger.debug(`[Governance] Using default weight ${votingPower} for non-validator voter ${vote.voter}`);
                }
            } catch (error) {
                logger.warn(`[Governance] Error checking validator status for voter ${vote.voter}, using default weight:`, error);
            }
            
            proposalVotes.votes.set(vote.voter, {
                option: voteOption.option,
                voting_power: votingPower,
                vote_time: vote.vote_time,
                tx_hash: vote.tx_hash,
                is_validator: isValidator
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
        } catch (error) {
            logger.error(`[Governance] Error updating vote counts for proposal ${proposalId}:`, error);
            throw error;
        }
    }
} 