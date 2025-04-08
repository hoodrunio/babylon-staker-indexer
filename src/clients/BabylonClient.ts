import { Network, FinalityProvider, FinalityParams, Vote, CurrentEpochResponse } from '../types/finality';
import { BlockClient, BlockResult } from './BlockClient';
import { TransactionClient } from './TransactionClient';
import { GovernanceClient } from './GovernanceClient';
import { FinalityClient } from './FinalityClient';
import { StakingClient } from './StakingClient';
import { CosmosClient } from './CosmosClient';
import { CosmWasmClient } from './CosmWasmClient';
import { logger } from '../utils/logger';
import { CustomError } from './BaseClient';
import { handleFutureBlockError } from '../utils/futureBlockHelper';
import { FutureBlockError } from '../types/errors';

// New interface and classes for URL management
export interface EndpointConfig {
    nodeUrls: string[];
    rpcUrls: string[];
    wsUrls?: string[];
}

export class UrlManager {
    private nodeUrlIndex = 0;
    private rpcUrlIndex = 0;
    private wsUrlIndex = 0;

    private readonly nodeUrls: string[];
    private readonly rpcUrls: string[];
    private readonly wsUrls: string[];

    constructor(config: EndpointConfig) {
        this.nodeUrls = config.nodeUrls;
        this.rpcUrls = config.rpcUrls;
        this.wsUrls = config.wsUrls || [];

        if (this.nodeUrls.length === 0) {
            throw new Error('At least one node URL must be provided');
        }

        if (this.rpcUrls.length === 0) {
            throw new Error('At least one RPC URL must be provided');
        }
    }

    public getNodeUrl(): string {
        return this.nodeUrls[this.nodeUrlIndex];
    }

    public getRpcUrl(): string {
        return this.rpcUrls[this.rpcUrlIndex];
    }

    public getWsUrl(): string | undefined {
        if (this.wsUrls.length === 0) {
            return undefined;
        }
        return this.wsUrls[this.wsUrlIndex];
    }

    public getNodeUrls(): string[] {
        return [...this.nodeUrls];
    }

    public getRpcUrls(): string[] {
        return [...this.rpcUrls];
    }

    public getWsUrls(): string[] {
        return [...this.wsUrls];
    }

    public rotateNodeUrl(): string {
        this.nodeUrlIndex = (this.nodeUrlIndex + 1) % this.nodeUrls.length;
        return this.getNodeUrl();
    }

    public rotateRpcUrl(): string {
        this.rpcUrlIndex = (this.rpcUrlIndex + 1) % this.rpcUrls.length;
        return this.getRpcUrl();
    }

    public rotateWsUrl(): string | undefined {
        if (this.wsUrls.length === 0) {
            return undefined;
        }
        this.wsUrlIndex = (this.wsUrlIndex + 1) % this.wsUrls.length;
        return this.getWsUrl();
    }
}

/**
 * BabylonClient is the main entry point for interacting with the Babylon blockchain.
 * This class maintains the existing API and ensures backward compatibility by using
 * decoupled sub-clients, adhering to SOLID principles.
 */
export class BabylonClient {
    private static instances: Map<Network, BabylonClient> = new Map();

    // Sub-clients
    private readonly blockClient: BlockClient;
    private readonly transactionClient: TransactionClient;
    private readonly governanceClient: GovernanceClient;
    private readonly finalityClient: FinalityClient;
    private readonly stakingClient: StakingClient;
    private readonly cosmosClient: CosmosClient;
    private readonly _cosmWasmClient: CosmWasmClient;

    private readonly network: Network;
    private readonly urlManager: UrlManager;

    private constructor(network: Network) {
        this.network = network;

        // Load URL configurations from .env
        const endpointConfig = this.loadEndpointConfig(network);
        this.urlManager = new UrlManager(endpointConfig);

        // Create sub-clients
        this.blockClient = this.createBlockClient();
        this.transactionClient = this.createTransactionClient();
        this.governanceClient = this.createGovernanceClient();
        this.finalityClient = this.createFinalityClient();
        this.stakingClient = this.createStakingClient();
        this.cosmosClient = this.createCosmosClient();
        this._cosmWasmClient = this.createCosmWasmClient();
    }

    /**
     * Loads URL configurations from .env
     */
    private loadEndpointConfig(network: Network): EndpointConfig {
        // Determine environment variables
        const nodeUrlEnvVar = network === Network.MAINNET
            ? 'BABYLON_NODE_URLS'
            : 'BABYLON_TESTNET_NODE_URLS';

        const rpcUrlEnvVar = network === Network.MAINNET
            ? 'BABYLON_RPC_URLS'
            : 'BABYLON_TESTNET_RPC_URLS';

        const wsUrlEnvVar = network === Network.MAINNET
            ? 'BABYLON_WS_URLS'
            : 'BABYLON_TESTNET_WS_URLS';

        // Check for legacy environment variables for backward compatibility
        const legacyNodeUrlEnvVar = network === Network.MAINNET
            ? 'BABYLON_NODE_URL'
            : 'BABYLON_TESTNET_NODE_URL';

        const legacyRpcUrlEnvVar = network === Network.MAINNET
            ? 'BABYLON_RPC_URL'
            : 'BABYLON_TESTNET_RPC_URL';

        const legacyWsUrlEnvVar = network === Network.MAINNET
            ? 'BABYLON_WS_URL'
            : 'BABYLON_TESTNET_WS_URL';

        // Read URLs and convert comma-separated values to arrays
        let nodeUrls = process.env[nodeUrlEnvVar]?.split(',').map(url => url.trim()) || [];
        let rpcUrls = process.env[rpcUrlEnvVar]?.split(',').map(url => url.trim()) || [];
        let wsUrls = process.env[wsUrlEnvVar]?.split(',').map(url => url.trim()) || [];

        // Backward compatibility: Add legacy single URL environment variables if they exist
        if (process.env[legacyNodeUrlEnvVar]) {
            nodeUrls.push(process.env[legacyNodeUrlEnvVar]!);
        }

        if (process.env[legacyRpcUrlEnvVar]) {
            rpcUrls.push(process.env[legacyRpcUrlEnvVar]!);
        }

        if (process.env[legacyWsUrlEnvVar]) {
            wsUrls.push(process.env[legacyWsUrlEnvVar]!);
        }

        // Clean URLs (filter out empty ones)
        nodeUrls = nodeUrls.filter(url => url.length > 0);
        rpcUrls = rpcUrls.filter(url => url.length > 0);
        wsUrls = wsUrls.filter(url => url.length > 0);

        // URL check
        if (nodeUrls.length === 0 || rpcUrls.length === 0) {
            throw new Error(`Network ${network} is not configured. Please check your environment variables for ${nodeUrlEnvVar} and ${rpcUrlEnvVar}`);
        }

        return {
            nodeUrls,
            rpcUrls,
            wsUrls: wsUrls.length > 0 ? wsUrls : undefined
        };
    }

    /**
     * Creates a BlockClient instance
     */
    private createBlockClient(): BlockClient {
        return new BlockClient(
            this.network,
            this.urlManager.getNodeUrl(),
            this.urlManager.getRpcUrl(),
            this.urlManager.getWsUrl()
        );
    }

    /**
     * Creates a TransactionClient instance
     */
    private createTransactionClient(): TransactionClient {
        return new TransactionClient(
            this.network,
            this.urlManager.getNodeUrl(),
            this.urlManager.getRpcUrl(),
            this.urlManager.getWsUrl()
        );
    }

    /**
     * Creates a GovernanceClient instance
     */
    private createGovernanceClient(): GovernanceClient {
        return new GovernanceClient(
            this.network,
            this.urlManager.getNodeUrl(),
            this.urlManager.getRpcUrl(),
            this.urlManager.getWsUrl()
        );
    }

    /**
     * Creates a FinalityClient instance
     */
    private createFinalityClient(): FinalityClient {
        return new FinalityClient(
            this.network,
            this.urlManager.getNodeUrl(),
            this.urlManager.getRpcUrl(),
            this.urlManager.getWsUrl()
        );
    }

    /**
     * Creates a StakingClient instance
     */
    private createStakingClient(): StakingClient {
        return new StakingClient(
            this.network,
            this.urlManager.getNodeUrl(),
            this.urlManager.getRpcUrl(),
            this.urlManager.getWsUrl()
        );
    }

    /**
     * Creates a CosmosClient instance
     */
    private createCosmosClient(): CosmosClient {
        return new CosmosClient(
            this.network,
            this.urlManager.getNodeUrl(),
            this.urlManager.getRpcUrl(),
            this.urlManager.getWsUrl()
        );
    }

    /**
     * Creates a CosmWasmClient instance
     */
    private createCosmWasmClient(): CosmWasmClient {
        return new CosmWasmClient(
            this.network,
            this.urlManager.getNodeUrl(),
            this.urlManager.getRpcUrl(),
            this.urlManager.getWsUrl()
        );
    }

    /**
     * Rotates all clients to use the next URL in their respective endpoint lists
     */
    private rotateClients(): void {
        logger.info(`[BabylonClient] Rotating connection endpoints for ${this.network}`);

        // Rotate URLs
        this.urlManager.rotateNodeUrl();
        this.urlManager.rotateRpcUrl();
        this.urlManager.rotateWsUrl();

        // Recreate clients with Object.defineProperty to reassign readonly properties
        Object.defineProperty(this, 'blockClient', { value: this.createBlockClient() });
        Object.defineProperty(this, 'transactionClient', { value: this.createTransactionClient() });
        Object.defineProperty(this, 'governanceClient', { value: this.createGovernanceClient() });
        Object.defineProperty(this, 'finalityClient', { value: this.createFinalityClient() });
        Object.defineProperty(this, 'stakingClient', { value: this.createStakingClient() });
        Object.defineProperty(this, 'cosmosClient', { value: this.createCosmosClient() });
        Object.defineProperty(this, '_cosmWasmClient', { value: this.createCosmWasmClient() });

        logger.info(`[BabylonClient] Successfully rotated to new endpoints for ${this.network}`);
    }

    /**
     * Rotates clients and retries if the request fails
     */
    private async withFailover<T>(operation: () => Promise<T>): Promise<T> {
        const maxRetries = this.urlManager.getNodeUrls().length;
        let specialError: CustomError | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                logger.warn(`[BabylonClient] Operation failed on attempt ${attempt + 1}/${maxRetries} for ${this.network}`);

                // Check if this is a future block error
                if (error instanceof Error && error.name === 'HeightNotAvailableError') {
                    try {
                        // Try to enrich the error with estimated time information
                        const enhancedError = await handleFutureBlockError(error, this.network);
                        
                        // If successfully converted to FutureBlockError, throw it directly
                        if (enhancedError instanceof FutureBlockError) {
                            logger.info(`[BabylonClient] Future block detected: ${enhancedError.message}`);
                            throw enhancedError;
                        }
                        
                        // Otherwise, continue with normal error handling
                    } catch (enrichError) {
                        // If enhancing the error fails, just continue with normal error handling
                        logger.warn(`[BabylonClient] Failed to enhance future block error: ${enrichError instanceof Error ? enrichError.message : String(enrichError)}`);
                    }
                }

                // Check special error types
                if (error instanceof Error) {
                    // Transaction not found error
                    if (error.name === 'TxNotFoundError') {
                        if (specialError) {
                            // If the same error occurred in the previous attempt, terminate
                            logger.info(`[BabylonClient] Transaction not found error persists across multiple nodes, stopping retries.`);
                            throw error;
                        }
                        // If this is the first time we encounter this error, save it and try with a different URL
                        specialError = error as CustomError;
                    }
                    // Block height not available error
                    else if (error.name === 'HeightNotAvailableError') {
                        if (specialError) {
                            // If the same error occurred in the previous attempt, terminate
                            logger.info(`[BabylonClient] Height not available error persists across multiple nodes, stopping retries.`);
                            throw error;
                        }
                        // If this is the first time we encounter this error, save it and try with a different URL
                        specialError = error as CustomError;
                    }
                    // Invalid Hex format error
                    else if (error.name === 'InvalidHexFormatError') {
                        // For hex format errors, throw the error directly without any rotation
                        logger.info(`[BabylonClient] Invalid hex format error detected, no retry necessary.`);
                        throw error;
                    }
                }

                // Check for JSON-RPC errors with "height must be less than or equal to the current blockchain height" message
                if ((error as any).response?.data?.error?.data && 
                    typeof (error as any).response.data.error.data === 'string' && 
                    (error as any).response.data.error.data.includes('height') && 
                    (error as any).response.data.error.data.includes('must be less than or equal to the current blockchain height')) {
                    
                    logger.info(`[BabylonClient] Block height not available (future block), stopping retries.`);
                    
                    // Extract the target height and current height from the error message
                    const errorData = (error as any).response.data.error.data;
                    const heightMatch = errorData.match(/height\s+(\d+)\s+must\s+be\s+less\s+than\s+or\s+equal\s+to\s+the\s+current\s+blockchain\s+height\s+(\d+)/i);
                    
                    let targetHeight: number | undefined;
                    let currentBlockchainHeight: number | undefined;
                    
                    if (heightMatch && heightMatch.length >= 3) {
                        targetHeight = parseInt(heightMatch[1]);
                        currentBlockchainHeight = parseInt(heightMatch[2]);
                    }
                    
                    // Create a special error for height not available with additional data
                    const heightNotAvailableError: CustomError = new Error('SPECIAL_ERROR_FUTURE_HEIGHT');
                    heightNotAvailableError.name = 'HeightNotAvailableError';
                    heightNotAvailableError.originalError = error;
                    
                    // Add extracted height information to the error
                    if (targetHeight && currentBlockchainHeight) {
                        heightNotAvailableError.details = {
                            targetHeight,
                            currentBlockchainHeight,
                            blockDifference: targetHeight - currentBlockchainHeight
                        };
                    }
                    
                    throw heightNotAvailableError;
                }

                // Also check for direct JSON-RPC error format
                if ((error as any).error?.message && 
                    typeof (error as any).error.message === 'string' && 
                    (error as any).error.message.includes('Internal error') &&
                    (error as any).error.data && 
                    typeof (error as any).error.data === 'string' && 
                    (error as any).error.data.includes('height') && 
                    (error as any).error.data.includes('must be less than or equal to the current blockchain height')) {
                    
                    logger.info(`[BabylonClient] Block height not available in JSON-RPC format (future block), stopping retries.`);
                    
                    // Extract the target height and current height from the error message
                    const errorData = (error as any).error.data;
                    const heightMatch = errorData.match(/height\s+(\d+)\s+must\s+be\s+less\s+than\s+or\s+equal\s+to\s+the\s+current\s+blockchain\s+height\s+(\d+)/i);
                    
                    let targetHeight: number | undefined;
                    let currentBlockchainHeight: number | undefined;
                    
                    if (heightMatch && heightMatch.length >= 3) {
                        targetHeight = parseInt(heightMatch[1]);
                        currentBlockchainHeight = parseInt(heightMatch[2]);
                    }
                    
                    // Create a special error for height not available with additional data
                    const heightNotAvailableError: CustomError = new Error('SPECIAL_ERROR_FUTURE_HEIGHT');
                    heightNotAvailableError.name = 'HeightNotAvailableError';
                    heightNotAvailableError.originalError = error;
                    
                    // Add extracted height information to the error
                    if (targetHeight && currentBlockchainHeight) {
                        heightNotAvailableError.details = {
                            targetHeight,
                            currentBlockchainHeight,
                            blockDifference: targetHeight - currentBlockchainHeight
                        };
                    }
                    
                    throw heightNotAvailableError;
                }

                // If not the last attempt, rotate clients and retry
                if (attempt < maxRetries - 1) {
                    this.rotateClients();
                } else {
                    // If it's the last attempt, throw the error
                    logger.error(`[BabylonClient] All failover attempts failed for ${this.network}`);
                    throw error;
                }
            }
        }

        // This point should never be reached, but it's here to satisfy TypeScript
        throw new Error(`[BabylonClient] Unexpected error in failover logic for ${this.network}`);
    }

    public static getInstance(network: Network = Network.MAINNET): BabylonClient {
        if (!BabylonClient.instances.has(network)) {
            BabylonClient.instances.set(network, new BabylonClient(network));
        }
        return BabylonClient.instances.get(network)!;
    }

    // General information methods
    public getNetwork(): Network {
        return this.network;
    }

    public getWsEndpoint(): string {
        try {
            // Try to get it from blockClient first
            const wsEndpoint = this.blockClient.getWsEndpoint();
            if (wsEndpoint) {
                return wsEndpoint;
            }

            // If not available from BlockClient, try UrlManager
            const wsUrl = this.urlManager.getWsUrl();
            if (wsUrl) {
                return wsUrl;
            }

            // If no WebSocket URL is found anywhere, return an empty string instead of null
            logger.warn(`[BabylonClient] No WebSocket URL found for ${this.network}`);
            return '';
        } catch (error) {
            logger.error(`[BabylonClient] Error getting WebSocket URL for ${this.network}: ${error instanceof Error ? error.message : String(error)}`);
            return '';
        }
    }

    public getBaseUrl(): string {
        return this.blockClient.getBaseUrl();
    }

    public getRpcUrl(): string {
        return this.blockClient.getRpcUrl();
    }

    public rotateNodeUrl(): string {
        return this.urlManager.rotateNodeUrl();
    }

    // BlockClient methods
    public async getCurrentHeight(): Promise<number> {
        return this.withFailover(() => this.blockClient.getCurrentHeight());
    }

    public async getBlockResults(height: number): Promise<BlockResult | null> {
        return this.withFailover(() => this.blockClient.getBlockResults(height));
    }

    public async getBlockByHeight(height: number): Promise<any> {
        return this.withFailover(() => this.blockClient.getBlockByHeight(height));
    }
    /**
     * Gets the latest block
     */
    public async getLatestBlock(): Promise<{
        block: {
            header: {
                height: string;
                time: string;
            };
            data: any;
        };
    }> {
        return this.withFailover(() => this.blockClient.getLatestBlock());
    }

    public async getBlockByHash(hash: string): Promise<any> {
        return this.withFailover(() => this.blockClient.getBlockByHash(hash));
    }

    public async getTxSearch(height: number): Promise<any> {
        return this.withFailover(() => this.blockClient.getTxSearch(height));
    }

    // TransactionClient methods
    public async getTransaction(txHash: string): Promise<any | null> {
        return this.withFailover(() => this.transactionClient.getTransaction(txHash));
    }

    public async searchTxs(query: string, page: number = 1, limit: number = 100): Promise<any> {
        return this.withFailover(() => this.transactionClient.searchTxs(query, page, limit));
    }

    public async getDelegateTransactions(startHeight: number, endHeight: number): Promise<any[]> {
        return this.withFailover(() => this.transactionClient.getDelegateTransactions(startHeight, endHeight));
    }

    public async getUnbondingTransactions(startHeight: number, endHeight: number): Promise<any[]> {
        return this.withFailover(() => this.transactionClient.getUnbondingTransactions(startHeight, endHeight));
    }

    public async getAllStakingTransactions(startHeight: number, endHeight: number): Promise<{
        delegateTransactions: any[];
        unbondingTransactions: any[];
    }> {
        return this.withFailover(() => this.transactionClient.getAllStakingTransactions(startHeight, endHeight));
    }

    // GovernanceClient methods
    public async getProposals(): Promise<any[]> {
        return this.withFailover(() => this.governanceClient.getProposals());
    }

    public async getProposalVotes(proposalId: number): Promise<any[]> {
        return this.withFailover(() => this.governanceClient.getProposalVotes(proposalId));
    }

    public async getProposalTally(proposalId: number): Promise<any> {
        return this.withFailover(() => this.governanceClient.getProposalTally(proposalId));
    }

    public async getProposalDetails(proposalId: number): Promise<any> {
        return this.withFailover(() => this.governanceClient.getProposalDetails(proposalId));
    }

    public async getGovernanceParams(): Promise<any> {
        return this.withFailover(() => this.governanceClient.getGovernanceParams());
    }

    // FinalityClient methods
    public async getCurrentEpoch(): Promise<CurrentEpochResponse> {
        return this.withFailover(() => this.finalityClient.getCurrentEpoch());
    }

    public async getFinalityParams(): Promise<FinalityParams> {
        return this.withFailover(() => this.finalityClient.getFinalityParams());
    }

    public async getActiveFinalityProvidersAtHeight(height: number): Promise<FinalityProvider[]> {
        return this.withFailover(() => this.finalityClient.getActiveFinalityProvidersAtHeight(height));
    }

    public async getVotesAtHeight(height: number): Promise<Vote[]> {
        return this.withFailover(() => this.finalityClient.getVotesAtHeight(height));
    }

    public async getModuleParams(module: string): Promise<any> {
        return this.withFailover(() => this.finalityClient.getModuleParams(module));
    }

    public async getIncentiveParams(): Promise<any> {
        return this.withFailover(() => this.finalityClient.getIncentiveParams());
    }

    // StakingClient methods
    public async getUnbondingPeriod(validatorAddress?: string): Promise<number> {
        return this.withFailover(() => this.stakingClient.getUnbondingPeriod(validatorAddress));
    }

    /**
     * Gets transaction details by hash
     * @param txHash Transaction hash
     */
    public async getTxByHash(txHash: string): Promise<any | null> {
        return this.withFailover(() => this.transactionClient.getTransaction(txHash));
    }

    // CosmosClient methods
    public async getCosmosModuleParams(module: string): Promise<any> {
        return this.withFailover(() => this.cosmosClient.getModuleParams(module));
    }

    public async getSlashingParams(): Promise<any> {
        return this.withFailover(() => this.cosmosClient.getSlashingParams());
    }

    public async getStakingParams(): Promise<any> {
        return this.withFailover(() => this.cosmosClient.getStakingParams());
    }

    public async getMintParams(): Promise<any> {
        return this.withFailover(() => this.cosmosClient.getMintParams());
    }

    public async getGovParams(): Promise<any> {
        return this.withFailover(() => this.cosmosClient.getGovParams());
    }

    public async getDistributionParams(): Promise<any> {
        return this.cosmosClient.getDistributionParams();
    }

    /**
     * Access the CosmWasm client for low-level operations
     */
    public get cosmWasmClient(): CosmWasmClient {
        return this._cosmWasmClient;
    }
}