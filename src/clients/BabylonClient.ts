import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import {
    Network,
    FinalityProvider,
    FinalityParams,
    Vote,
    CurrentEpochResponse
} from '../types/finality';
import { logger } from '../utils/logger';

interface RetryConfig extends InternalAxiosRequestConfig {
    retry?: boolean;
    currentRetryCount?: number;
}

export interface BlockResult {
    height: number;
    txs_results: Array<{
        events: Array<{
            type: string;
            attributes: Array<{
                key: string;
                value: string;
            }>;
        }>;
    }>;
}

export class BabylonClient {
    private static instances: Map<Network, BabylonClient> = new Map();
    private readonly client: AxiosInstance;
    private readonly wsEndpoint: string;
    private readonly network: Network;
    private readonly baseUrl: string;
    private readonly baseRpcUrl: string;
    private currentEpochInfo: CurrentEpochResponse | null = null;
    private readonly MAX_RETRIES = 5;
    private readonly RETRY_DELAY = 2000; // 2 seconds
    private readonly MAX_RETRY_DELAY = 10000; // 10 seconds

    private constructor(network: Network) {
        this.network = network;
        
        const nodeUrl = network === Network.MAINNET 
            ? process.env.BABYLON_NODE_URL 
            : process.env.BABYLON_TESTNET_NODE_URL;
            
        const rpcUrl = network === Network.MAINNET 
            ? process.env.BABYLON_RPC_URL 
            : process.env.BABYLON_TESTNET_RPC_URL;
            
        const wsUrl = network === Network.MAINNET
            ? process.env.BABYLON_WS_URL
            : process.env.BABYLON_TESTNET_WS_URL;

        // Check if the requested network is configured
        if (!nodeUrl || !rpcUrl) {
            throw new Error(`Network ${network} is not configured. Please check your environment variables for ${network === Network.MAINNET ? 'BABYLON_NODE_URL and BABYLON_RPC_URL' : 'BABYLON_TESTNET_NODE_URL and BABYLON_TESTNET_RPC_URL'}`);
        }

        this.baseUrl = nodeUrl;
        this.baseRpcUrl = rpcUrl;

        if (!wsUrl) {
            logger.warn(`WebSocket URL not configured for ${network} network, falling back to RPC URL`);
            this.wsEndpoint = `${rpcUrl.replace(/^http/, 'ws')}/websocket`;
        } else {
            this.wsEndpoint = wsUrl;
        }

        this.client = axios.create({
            baseURL: nodeUrl,
            timeout: 30000,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Network': network
            }
        });

        // Add retry interceptor
        this.client.interceptors.request.use((config: RetryConfig) => {
            if (!config || !config.retry) {
                return config;
            }

            config.currentRetryCount = config.currentRetryCount ?? 0;

            if (config.currentRetryCount >= this.MAX_RETRIES) {
                return Promise.reject(`Max retries (${this.MAX_RETRIES}) reached`);
            }

            config.currentRetryCount += 1;

            const delayTime = Math.min(
                this.MAX_RETRY_DELAY,
                this.RETRY_DELAY * Math.pow(2, config.currentRetryCount - 1)
            );

            if (config.currentRetryCount > 1) {
                logger.debug(`[Retry] Attempt ${config.currentRetryCount} for ${config.url}`);
            }

            return new Promise(resolve => setTimeout(() => resolve(config), delayTime));
        });

        // Add retry config to each request
        this.client.interceptors.request.use((config: RetryConfig) => {
            config.retry = true;
            config.currentRetryCount = 0;
            return config;
        });
    }

    public static getInstance(network: Network = Network.TESTNET): BabylonClient {
        if (!BabylonClient.instances.has(network)) {
            BabylonClient.instances.set(network, new BabylonClient(network));
        }
        return BabylonClient.instances.get(network)!;
    }

    public getNetwork(): Network {
        return this.network;
    }

    public getWsEndpoint(): string {
        return this.wsEndpoint;
    }

    public getBaseUrl(): string {
        return this.baseUrl;
    }

    public getRpcUrl(): string {
        return this.baseRpcUrl;
    }

    public async getCurrentHeight(): Promise<number> {
        try {
            const response = await this.client.post(this.baseRpcUrl, {
                jsonrpc: "2.0",
                id: -1,
                method: "abci_info",
                params: []
            });

            if (response.data?.result?.response?.last_block_height) {
                return parseInt(response.data.result.response.last_block_height, 10);
            }

            throw new Error('Invalid response format from RPC endpoint');
        } catch (error) {
            if (error instanceof Error) {
                logger.error('[Height] Failed to get current height:', error.message);
            } else {
                logger.error('[Height] Failed to get current height:', error);
            }
            throw new Error('Failed to get current height');
        }
    }

    async getVotesAtHeight(height: number): Promise<Vote[]> {
        try {
            logger.debug(`[Votes] Fetching votes for height ${height}`);
            const response = await this.client.get(`/babylon/finality/v1/votes/${height}`);
            
            if (!response.data) {
                logger.warn(`[Votes] No data in response for height ${height}`);
                return [];
            }

            if (!response.data.btc_pks) {
                logger.warn(`[Votes] No btc_pks in response for height ${height}`);
                return [];
            }

            if (!Array.isArray(response.data.btc_pks)) {
                logger.warn(`[Votes] btc_pks is not an array for height ${height}`);
                return [];
            }

            logger.debug(`[Votes] Found ${response.data.btc_pks.length} votes for height ${height}`);
            
            // Duplicate check
            const uniquePks = new Set(response.data.btc_pks);
            if (uniquePks.size !== response.data.btc_pks.length) {
                logger.warn(`[Votes] Found ${response.data.btc_pks.length - uniquePks.size} duplicate votes for height ${height}`);
            }

            const currentTime = new Date().toISOString();
            const votes = response.data.btc_pks.map((btcPk: string) => {
                // Validate btcPk format
                if (typeof btcPk !== 'string' || btcPk.length !== 64) {
                    logger.warn(`[Votes] Invalid btcPk format at height ${height}: ${btcPk}`);
                    return null;
                }
                return {
                    fp_btc_pk_hex: btcPk.toLowerCase(),
                    signature: '',
                    timestamp: currentTime
                };
            }).filter((vote: Vote | null): vote is Vote => vote !== null);

            // logger.debug(`[Votes] Processed ${votes.length} valid votes for height ${height}`);
            return votes;
        } catch (error) {
            if (error instanceof Error) {
                logger.error(`[Votes] Error fetching votes at height ${height}:`, error.message);
            } else {
                logger.error(`[Votes] Error fetching votes at height ${height}:`, error);
            }
            return [];
        }
    }

    async getCurrentEpoch(): Promise<CurrentEpochResponse> {
        try {
            const response = await this.client.get('/babylon/epoching/v1/current_epoch');
            const data = response.data;
            logger.debug(`[Current Epoch Response] Current epoch: ${data.current_epoch}, Boundary: ${data.epoch_boundary}`);

            const current_epoch = Number(data.current_epoch);
            const epoch_boundary = Number(data.epoch_boundary);

            if (isNaN(current_epoch) || isNaN(epoch_boundary)) {
                throw new Error('Invalid epoch data received from API');
            }

            this.currentEpochInfo = { current_epoch, epoch_boundary };
            return this.currentEpochInfo;
        } catch (error) {
            logger.error('Error fetching current epoch:', error);
            throw error;
        }
    }

    async getFinalityParams(): Promise<FinalityParams> {
        try {
            const response = await this.client.get('/babylon/finality/v1/params');
            return response.data.params;
        } catch (error) {
            logger.error('Error fetching finality params:', error);
            throw error;
        }
    }

    async getActiveFinalityProvidersAtHeight(height: number): Promise<FinalityProvider[]> {
        try {
            const response = await this.client.get(`/babylon/finality/v1/finality_providers/${height}`);
            return response.data.finality_providers.map((provider: any) => ({
                fpBtcPkHex: provider.btc_pk_hex,
                height: parseInt(provider.height),
                votingPower: provider.voting_power,
                slashedBabylonHeight: provider.slashed_babylon_height,
                slashedBtcHeight: provider.slashed_btc_height,
                jailed: provider.jailed,
                highestVotedHeight: provider.highest_voted_height,
                description: provider.description
            }));
        } catch (error) {
            logger.error(`Error getting active finality providers at height ${height}:`, error);
            throw error;
        }
    }

    async getBlockResults(height: number): Promise<BlockResult | null> {
        try {
            logger.debug(`[Block Results] Fetching results for height ${height}`);
            const rpcUrl = this.network === Network.MAINNET 
                ? process.env.BABYLON_RPC_URL 
                : process.env.BABYLON_TESTNET_RPC_URL;

            if (!rpcUrl) {
                throw new Error(`RPC URL not configured for ${this.network} network`);
            }

            const response = await axios.get(`${rpcUrl}/block_results?height=${height}`);
            
            if (!response.data?.result) {
                logger.warn(`[Block Results] No data in response for height ${height}`);
                return null;
            }

            // Convert RPC response to the format expected by MissedBlocksProcessor
            const formattedResults: BlockResult = {
                height: height,
                txs_results: (response.data.result.txs_results || []).map((txResult: any) => ({
                    events: (txResult.events || []).map((event: any) => ({
                        type: event.type,
                        attributes: event.attributes || []
                    }))
                }))
            };

            return formattedResults;
        } catch (error) {
            if (error instanceof Error) {
                logger.error(`[Block Results] Error fetching block results at height ${height}:`, error.message);
            } else {
                logger.error(`[Block Results] Error fetching block results at height ${height}:`, error);
            }
            throw error;
        }
    }

    async getModuleParams(module: string): Promise<any> {
        try {
            const response = await this.client.get(`/babylon/${module}/v1/params`);
            return response.data.params;
        } catch (error) {
            logger.error(`Error fetching ${module} params:`, error);
            throw error;
        }
    }


    async getIncentiveParams(): Promise<any> {
        try {
            const response = await this.client.get('/babylon/incentive/params');
            return response.data.params;
        } catch (error) {
            logger.error('Error fetching incentive params:', error);
            throw error;
        }
    }

    private async fetchWithTimeout(url: string, timeout: number = 10000): Promise<Response> {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                signal: controller.signal
            });
            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            throw error;
        }
    }

    public async getTxSearch(height: number): Promise<any> {
        const url = new URL(`${this.baseUrl}/tx_search`);
        url.searchParams.append('query', `tx.height=${height}`);
        url.searchParams.append('page', '1');
        url.searchParams.append('per_page', '500');

        const response = await this.fetchWithTimeout(url.toString());
        const data = await response.json() as { result: any };
        return data.result;
    }

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

    async searchTxs(query: string, page: number = 1, limit: number = 100): Promise<any> {
        try {
            logger.info(`[Governance] Searching transactions with query: ${query}, page: ${page}, limit: ${limit}`);
            const params = new URLSearchParams({
                'query': query,
                'pagination.limit': limit.toString(),
                'page': page.toString(),
                'order_by': 'ORDER_BY_DESC'
            });

            const url = `/cosmos/tx/v1beta1/txs?${params.toString()}`;

            const response = await this.client.get(url);
            
            if (!response.data) {
                logger.warn('[Governance] No transactions found in response');
                return null;
            }

            if (response.data.txs) {
                logger.info(`[Governance] Found ${response.data.txs.length} transactions`);
            }

            return response.data;
        } catch (error) {
            logger.error('[Governance] Error searching transactions:', error);
            return null;
        }
    }

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