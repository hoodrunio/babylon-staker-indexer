import { BaseClient } from './BaseClient';
import { logger } from '../utils/logger';

/**
 * Client used to retrieve governance data
 */
export class GovernanceClient extends BaseClient {
    /**
     * @param network Network type
     * @param nodeUrl Node URL
     * @param rpcUrl RPC URL
     * @param wsUrl WebSocket URL (optional)
     */
    public constructor(
        network: any,
        nodeUrl: string,
        rpcUrl: string,
        wsUrl?: string
    ) {
        super(network, nodeUrl, rpcUrl, wsUrl);
    }

    /**
     * Gets all proposals
     */
    async getProposals(): Promise<any[]> {
        try {
            logger.debug('[Governance] Fetching all proposals');
            let allProposals: any[] = [];
            let nextKey: string | null = null;

            do {
                const params = new URLSearchParams();
                if (nextKey) {
                    params.append('pagination.key', nextKey);
                }

                const response = await this.client.get(`/cosmos/gov/v1/proposals?${params.toString()}`);
                
                if (!response.data || !response.data.proposals) {
                    logger.warn('[Governance] No proposals found in response');
                    break;
                }

                allProposals = allProposals.concat(response.data.proposals);
                nextKey = response.data.pagination?.next_key || null;
            } while (nextKey);

            return allProposals;
        } catch (error) {
            logger.error('[Governance] Error fetching proposals:', error);
            return [];
        }
    }

    /**
     * Gets the votes for a specific proposal
     * @param proposalId Proposal ID
     */
    async getProposalVotes(proposalId: number): Promise<any[]> {
        try {
            logger.debug(`[Governance] Fetching votes for proposal ${proposalId}`);
            let allVotes: any[] = [];
            let nextKey: string | null = null;

            do {
                const params = new URLSearchParams();
                if (nextKey) {
                    params.append('pagination.key', nextKey);
                }

                const response = await this.client.get(`/cosmos/gov/v1/proposals/${proposalId}/votes?${params.toString()}`);
                
                if (!response.data || !response.data.votes) {
                    logger.warn(`[Governance] No votes found for proposal ${proposalId}`);
                    break;
                }

                allVotes = allVotes.concat(response.data.votes);
                nextKey = response.data.pagination?.next_key || null;
            } while (nextKey);

            return allVotes;
        } catch (error) {
            logger.error(`[Governance] Error fetching votes for proposal ${proposalId}:`, error);
            return [];
        }
    }

    /**
     * Gets the tally results for a specific proposal
     * @param proposalId Proposal ID
     */
    async getProposalTally(proposalId: number): Promise<any> {
        try {
            logger.debug(`[Governance] Fetching tally for proposal ${proposalId}`);
            const response = await this.client.get(`/cosmos/gov/v1/proposals/${proposalId}/tally`);
            
            if (!response.data || !response.data.tally) {
                logger.warn(`[Governance] No tally found for proposal ${proposalId}`);
                return null;
            }

            return response.data.tally;
        } catch (error) {
            logger.error(`[Governance] Error fetching tally for proposal ${proposalId}:`, error);
            return null;
        }
    }

    /**
     * Gets the details of a specific proposal
     * @param proposalId Proposal ID
     */
    async getProposalDetails(proposalId: number): Promise<any> {
        try {
            logger.debug(`[Governance] Fetching details for proposal ${proposalId}`);
            const response = await this.client.get(`/cosmos/gov/v1/proposals/${proposalId}`);
            
            if (!response.data || !response.data.proposal) {
                logger.warn(`[Governance] No data found for proposal ${proposalId}`);
                return null;
            }

            return response.data.proposal;
        } catch (error) {
            logger.error(`[Governance] Error fetching proposal ${proposalId}:`, error);
            return null;
        }
    }

    /**
     * Gets the governance parameters
     */
    async getGovernanceParams(): Promise<any> {
        try {
            logger.debug('[Governance] Fetching governance parameters');
            const response = await this.client.get('/cosmos/gov/v1/params/tallying');
            
            if (!response.data) {
                logger.warn('[Governance] No governance parameters found in response');
                return null;
            }

            return response.data;
        } catch (error) {
            logger.error('[Governance] Error fetching governance parameters:', error);
            return null;
        }
    }
}