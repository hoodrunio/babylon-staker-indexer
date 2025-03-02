import { Network, FinalityProvider, FinalityParams, Vote, CurrentEpochResponse } from '../types/finality';
import { BlockClient, BlockResult } from './BlockClient';
import { TransactionClient } from './TransactionClient';
import { GovernanceClient } from './GovernanceClient';
import { FinalityClient } from './FinalityClient';
import { StakingClient } from './StakingClient';

/**
 * BabylonClient, Babylon blockchain ile etkileşim için ana giriş noktasıdır.
 * Bu sınıf, SOLID prensiplerine uygun olarak ayrıştırılmış alt istemcileri kullanarak
 * mevcut API'yi korur ve geriye dönük uyumluluğu sağlar.
 */
export class BabylonClient {
    private static instances: Map<Network, BabylonClient> = new Map();
    
    // Alt istemciler
    private readonly blockClient: BlockClient;
    private readonly transactionClient: TransactionClient;
    private readonly governanceClient: GovernanceClient;
    private readonly finalityClient: FinalityClient;
    private readonly stakingClient: StakingClient;
    
    private readonly network: Network;

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

        // Alt istemcileri oluştur
        this.blockClient = new BlockClient(network, nodeUrl, rpcUrl, wsUrl);
        this.transactionClient = new TransactionClient(network, nodeUrl, rpcUrl, wsUrl);
        this.governanceClient = new GovernanceClient(network, nodeUrl, rpcUrl, wsUrl);
        this.finalityClient = new FinalityClient(network, nodeUrl, rpcUrl, wsUrl);
        this.stakingClient = new StakingClient(network, nodeUrl, rpcUrl, wsUrl);
    }

    public static getInstance(network: Network = Network.TESTNET): BabylonClient {
        if (!BabylonClient.instances.has(network)) {
            BabylonClient.instances.set(network, new BabylonClient(network));
        }
        return BabylonClient.instances.get(network)!;
    }

    // Genel bilgi metodları
    public getNetwork(): Network {
        return this.network;
    }

    public getWsEndpoint(): string {
        return this.blockClient.getWsEndpoint();
    }

    public getBaseUrl(): string {
        return this.blockClient.getBaseUrl();
    }

    public getRpcUrl(): string {
        return this.blockClient.getRpcUrl();
    }

    // BlockClient metodları
    public async getCurrentHeight(): Promise<number> {
        return this.blockClient.getCurrentHeight();
    }

    public async getBlockResults(height: number): Promise<BlockResult | null> {
        return this.blockClient.getBlockResults(height);
    }

    public async getLatestBlock(): Promise<{
        header: {
            height: number;
            time: string;
        };
        data: any;
    }> {
        return this.blockClient.getLatestBlock();
    }

    public async getTxSearch(height: number): Promise<any> {
        return this.blockClient.getTxSearch(height);
    }

    // TransactionClient metodları
    public async getTransaction(txHash: string): Promise<any | null> {
        return this.transactionClient.getTransaction(txHash);
    }

    public async searchTxs(query: string, page: number = 1, limit: number = 100): Promise<any> {
        return this.transactionClient.searchTxs(query, page, limit);
    }

    public async getDelegateTransactions(startHeight: number, endHeight: number): Promise<any[]> {
        return this.transactionClient.getDelegateTransactions(startHeight, endHeight);
    }

    public async getUnbondingTransactions(startHeight: number, endHeight: number): Promise<any[]> {
        return this.transactionClient.getUnbondingTransactions(startHeight, endHeight);
    }

    public async getAllStakingTransactions(startHeight: number, endHeight: number): Promise<{
        delegateTransactions: any[];
        unbondingTransactions: any[];
    }> {
        return this.transactionClient.getAllStakingTransactions(startHeight, endHeight);
    }

    // GovernanceClient metodları
    public async getProposals(): Promise<any[]> {
        return this.governanceClient.getProposals();
    }

    public async getProposalVotes(proposalId: number): Promise<any[]> {
        return this.governanceClient.getProposalVotes(proposalId);
    }

    public async getProposalTally(proposalId: number): Promise<any> {
        return this.governanceClient.getProposalTally(proposalId);
    }

    public async getProposalDetails(proposalId: number): Promise<any> {
        return this.governanceClient.getProposalDetails(proposalId);
    }

    public async getGovernanceParams(): Promise<any> {
        return this.governanceClient.getGovernanceParams();
    }

    // FinalityClient metodları
    public async getCurrentEpoch(): Promise<CurrentEpochResponse> {
        return this.finalityClient.getCurrentEpoch();
    }

    public async getFinalityParams(): Promise<FinalityParams> {
        return this.finalityClient.getFinalityParams();
    }

    public async getActiveFinalityProvidersAtHeight(height: number): Promise<FinalityProvider[]> {
        return this.finalityClient.getActiveFinalityProvidersAtHeight(height);
    }

    public async getVotesAtHeight(height: number): Promise<Vote[]> {
        return this.finalityClient.getVotesAtHeight(height);
    }

    public async getModuleParams(module: string): Promise<any> {
        return this.finalityClient.getModuleParams(module);
    }

    public async getIncentiveParams(): Promise<any> {
        return this.finalityClient.getIncentiveParams();
    }

    // StakingClient metodları
    public async getUnbondingPeriod(validatorAddress?: string): Promise<number> {
        return this.stakingClient.getUnbondingPeriod(validatorAddress);
    }
} 