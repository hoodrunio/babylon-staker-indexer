import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import {
    Network,
    FinalityProvider,
    EpochInfo,
    FinalityParams,
    Vote,
    CurrentEpochResponse
} from '../types/finality';

// Axios config için custom tip tanımı
interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
    retry?: boolean;
    currentRetryCount?: number;
}

interface RetryConfig extends InternalAxiosRequestConfig {
    retry?: boolean;
    currentRetryCount?: number;
}

export class BabylonClient {
    private static instances: Map<Network, BabylonClient> = new Map();
    private readonly client: AxiosInstance;
    private readonly wsEndpoint: string;
    private readonly network: Network;
    private readonly baseUrl: string;
    private epochCache: Map<number, EpochInfo> = new Map();
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

        if (!nodeUrl || !rpcUrl) {
            throw new Error(`Missing configuration for ${network} network. Please check your environment variables: ${network === Network.MAINNET ? 'BABYLON_NODE_URL and BABYLON_RPC_URL' : 'BABYLON_TESTNET_NODE_URL and BABYLON_TESTNET_RPC_URL'}`);
        }

        this.baseUrl = nodeUrl;

        if (!wsUrl) {
            console.warn(`WebSocket URL not configured for ${network} network, falling back to RPC URL`);
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
                console.debug(`[Retry] Attempt ${config.currentRetryCount} for ${config.url}`);
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

    async getCurrentHeight(): Promise<number> {
        try {
            const response = await this.client.get('/cosmos/base/tendermint/v1beta1/blocks/latest');
            return parseInt(response.data.block.header.height, 10);
        } catch (error) {
            if (error instanceof Error) {
                console.error('[Height] Failed to get current height:', error.message);
            } else {
                console.error('[Height] Failed to get current height:', error);
            }
            throw new Error('Failed to get current height');
        }
    }

    async getVotesAtHeight(height: number): Promise<Vote[]> {
        try {
            console.debug(`[Votes] Fetching votes for height ${height}`);
            const response = await this.client.get(`/babylon/finality/v1/votes/${height}`);
            
            if (!response.data) {
                console.warn(`[Votes] No data in response for height ${height}`);
                return [];
            }

            if (!response.data.btc_pks) {
                console.warn(`[Votes] No btc_pks in response for height ${height}`);
                return [];
            }

            if (!Array.isArray(response.data.btc_pks)) {
                console.warn(`[Votes] btc_pks is not an array for height ${height}`);
                return [];
            }

            console.debug(`[Votes] Found ${response.data.btc_pks.length} votes for height ${height}`);
            
            // Duplicate check
            const uniquePks = new Set(response.data.btc_pks);
            if (uniquePks.size !== response.data.btc_pks.length) {
                console.warn(`[Votes] Found ${response.data.btc_pks.length - uniquePks.size} duplicate votes for height ${height}`);
            }

            const currentTime = new Date().toISOString();
            const votes = response.data.btc_pks.map((btcPk: string) => {
                // Validate btcPk format
                if (typeof btcPk !== 'string' || btcPk.length !== 64) {
                    console.warn(`[Votes] Invalid btcPk format at height ${height}: ${btcPk}`);
                    return null;
                }
                return {
                    fp_btc_pk_hex: btcPk.toLowerCase(),
                    signature: '',
                    timestamp: currentTime
                };
            }).filter((vote: Vote | null): vote is Vote => vote !== null);

            // console.debug(`[Votes] Processed ${votes.length} valid votes for height ${height}`);
            return votes;
        } catch (error) {
            if (error instanceof Error) {
                console.error(`[Votes] Error fetching votes at height ${height}:`, error.message);
            } else {
                console.error(`[Votes] Error fetching votes at height ${height}:`, error);
            }
            return [];
        }
    }

    async getCurrentEpoch(): Promise<CurrentEpochResponse> {
        try {
            const response = await this.client.get('/babylon/epoching/v1/current_epoch');
            console.debug('[Current Epoch Response]', response.data);

            const current_epoch = Number(response.data.current_epoch);
            const epoch_boundary = Number(response.data.epoch_boundary);

            if (isNaN(current_epoch) || isNaN(epoch_boundary)) {
                throw new Error('Invalid epoch data received from API');
            }

            this.currentEpochInfo = { current_epoch, epoch_boundary };
            return this.currentEpochInfo;
        } catch (error) {
            console.error('Error fetching current epoch:', error);
            throw error;
        }
    }

    async getFinalityParams(): Promise<FinalityParams> {
        try {
            const response = await this.client.get('/babylon/finality/v1/params');
            return response.data.params;
        } catch (error) {
            console.error('Error fetching finality params:', error);
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
            console.error(`Error getting active finality providers at height ${height}:`, error);
            throw error;
        }
    }
} 