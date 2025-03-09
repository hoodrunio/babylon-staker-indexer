import { Network, FinalityProvider, FinalityParams, Vote, CurrentEpochResponse } from '../types/finality';
import { BlockClient, BlockResult } from './BlockClient';
import { TransactionClient } from './TransactionClient';
import { GovernanceClient } from './GovernanceClient';
import { FinalityClient } from './FinalityClient';
import { StakingClient } from './StakingClient';
import { logger } from '../utils/logger';

// URL yönetimi için yeni interface ve sınıflar
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
    private readonly urlManager: UrlManager;

    private constructor(network: Network) {
        this.network = network;
        
        // URL konfigürasyonlarını .env'den okuyalım
        const endpointConfig = this.loadEndpointConfig(network);
        this.urlManager = new UrlManager(endpointConfig);
        
        // Alt istemcileri oluştur
        this.blockClient = this.createBlockClient();
        this.transactionClient = this.createTransactionClient();
        this.governanceClient = this.createGovernanceClient();
        this.finalityClient = this.createFinalityClient();
        this.stakingClient = this.createStakingClient();
    }

    /**
     * URL konfigürasyonlarını .env'den okur
     */
    private loadEndpointConfig(network: Network): EndpointConfig {
        // Environment variable'ları belirle
        const nodeUrlEnvVar = network === Network.MAINNET 
            ? 'BABYLON_NODE_URLS' 
            : 'BABYLON_TESTNET_NODE_URLS';
            
        const rpcUrlEnvVar = network === Network.MAINNET 
            ? 'BABYLON_RPC_URLS' 
            : 'BABYLON_TESTNET_RPC_URLS';
            
        const wsUrlEnvVar = network === Network.MAINNET 
            ? 'BABYLON_WS_URLS' 
            : 'BABYLON_TESTNET_WS_URLS';
        
        // Geri uyumluluk için eski environment variable'ları da kontrol edelim
        const legacyNodeUrlEnvVar = network === Network.MAINNET 
            ? 'BABYLON_NODE_URL' 
            : 'BABYLON_TESTNET_NODE_URL';
            
        const legacyRpcUrlEnvVar = network === Network.MAINNET 
            ? 'BABYLON_RPC_URL' 
            : 'BABYLON_TESTNET_RPC_URL';
            
        const legacyWsUrlEnvVar = network === Network.MAINNET 
            ? 'BABYLON_WS_URL' 
            : 'BABYLON_TESTNET_WS_URL';
            
        // URL'leri oku ve virgülle ayrılmış değerleri diziye çevir
        let nodeUrls = process.env[nodeUrlEnvVar]?.split(',').map(url => url.trim()) || [];
        let rpcUrls = process.env[rpcUrlEnvVar]?.split(',').map(url => url.trim()) || [];
        let wsUrls = process.env[wsUrlEnvVar]?.split(',').map(url => url.trim()) || [];
        
        // Geri uyumluluk: Eski tek URL environment variable'ları varsa, onları da ekleyelim
        if (process.env[legacyNodeUrlEnvVar]) {
            nodeUrls.push(process.env[legacyNodeUrlEnvVar]!);
        }
        
        if (process.env[legacyRpcUrlEnvVar]) {
            rpcUrls.push(process.env[legacyRpcUrlEnvVar]!);
        }
        
        if (process.env[legacyWsUrlEnvVar]) {
            wsUrls.push(process.env[legacyWsUrlEnvVar]!);
        }
        
        // URL'leri temizle (boş olanları filtrele)
        nodeUrls = nodeUrls.filter(url => url.length > 0);
        rpcUrls = rpcUrls.filter(url => url.length > 0);
        wsUrls = wsUrls.filter(url => url.length > 0);
        
        // URL kontrolü
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
     * BlockClient örneği oluşturur
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
     * TransactionClient örneği oluşturur
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
     * GovernanceClient örneği oluşturur
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
     * FinalityClient örneği oluşturur
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
     * StakingClient örneği oluşturur
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
     * Hata durumunda bağlantı noktalarını döndürerek yeni istemciler oluşturur
     */
    private rotateClients(): void {
        logger.info(`[BabylonClient] Rotating connection endpoints for ${this.network}`);
        
        // URL'leri döndür
        this.urlManager.rotateNodeUrl();
        this.urlManager.rotateRpcUrl();
        this.urlManager.rotateWsUrl();
        
        // Yeni istemcileri oluştur
        try {
            const newBlockClient = this.createBlockClient();
            const newTransactionClient = this.createTransactionClient();
            const newGovernanceClient = this.createGovernanceClient();
            const newFinalityClient = this.createFinalityClient();
            const newStakingClient = this.createStakingClient();
            
            // Hepsi başarılı olursa, mevcut istemcileri güncelle
            Object.defineProperty(this, 'blockClient', { value: newBlockClient });
            Object.defineProperty(this, 'transactionClient', { value: newTransactionClient });
            Object.defineProperty(this, 'governanceClient', { value: newGovernanceClient });
            Object.defineProperty(this, 'finalityClient', { value: newFinalityClient });
            Object.defineProperty(this, 'stakingClient', { value: newStakingClient });
            
            logger.info(`[BabylonClient] Successfully rotated to new endpoints for ${this.network}`);
        } catch (error) {
            logger.error(`[BabylonClient] Failed to rotate clients for ${this.network}:`, error);
            throw error;
        }
    }
    
    /**
     * İstek hata alırsa istemcileri döndür ve yeniden dene
     */
    private async withFailover<T>(operation: () => Promise<T>): Promise<T> {
        const maxRetries = this.urlManager.getNodeUrls().length;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                logger.warn(`[BabylonClient] Operation failed on attempt ${attempt + 1}/${maxRetries} for ${this.network}`);
                
                // Son deneme değilse, istemcileri döndür ve yeniden dene
                if (attempt < maxRetries - 1) {
                    this.rotateClients();
                } else {
                    // Son denemeyse, hatayı fırlat
                    logger.error(`[BabylonClient] All failover attempts failed for ${this.network}`);
                    throw error;
                }
            }
        }
        
        // Bu noktaya asla ulaşılmamalı, ama TypeScript hata vermemesi için
        throw new Error(`[BabylonClient] Unexpected error in failover logic for ${this.network}`);
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
        try {
            // Önce blockClient'dan almayı deneyelim
            const wsEndpoint = this.blockClient.getWsEndpoint();
            if (wsEndpoint) {
                return wsEndpoint;
            }
            
            // BlockClient'dan alınamazsa, UrlManager'dan almayı deneyelim
            const wsUrl = this.urlManager.getWsUrl();
            if (wsUrl) {
                return wsUrl;
            }
            
            // Hiçbir yerde WebSocket URL'si bulunamazsa, null yerine boş string döndürelim
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

    // BlockClient metodları
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
     * En son bloğu alır
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

    // TransactionClient metodları
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

    // GovernanceClient metodları
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

    // FinalityClient metodları
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

    // StakingClient metodları
    public async getUnbondingPeriod(validatorAddress?: string): Promise<number> {
        return this.withFailover(() => this.stakingClient.getUnbondingPeriod(validatorAddress));
    }

    /**
     * Hash değerine göre işlem detaylarını getirir
     * @param txHash İşlem hash'i
     */
    public async getTxByHash(txHash: string): Promise<any | null> {
        return this.withFailover(() => this.transactionClient.getTransaction(txHash));
    }
} 