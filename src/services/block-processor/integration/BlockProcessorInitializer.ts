/**
 * Block Processor Initialization Service
 * Blok işleme sistemini başlatan ve yöneten servis
 */

import { BlockProcessorService } from '../common/blockProcessor.service';
import { TransactionProcessorService } from '../common/transactionProcessor.service';
import { BlockTransactionHandler } from '../handlers/BlockTransactionHandler';
import { BlockStorage } from '../storage/BlockStorage';
import { TxStorage } from '../storage/TxStorage';
import { logger } from '../../../utils/logger';
import { BabylonClient } from '../../../clients/BabylonClient';
import { Network } from '../../../types/finality';
import { createBlockTxProcessors } from '../handlers/messageProcessors';
import { IMessageProcessor } from '../../websocket/interfaces';
import { HistoricalSyncService } from '../sync/historicalSync.service';
import { FetcherService } from '../common/fetcher.service';

/**
 * BlockProcessor sistemini başlatan ve yöneten sınıf
 */
export class BlockProcessorInitializer {
    private static instance: BlockProcessorInitializer | null = null;
    private blockTransactionHandler: BlockTransactionHandler | null = null;
    private blockStorage: BlockStorage | null = null;
    private txStorage: TxStorage | null = null;
    private blockProcessor: BlockProcessorService | null = null;
    private txProcessor: TransactionProcessorService | null = null;
    private rpcClient: BabylonClient | null = null;
    private historicalSyncService: HistoricalSyncService | null = null;
    private fetcherService: FetcherService | null = null;
    private defaultNetwork: Network = Network.TESTNET;
    
    private constructor() {
        // Private constructor
    }
    
    /**
     * Singleton instance
     */
    public static getInstance(): BlockProcessorInitializer {
        if (!BlockProcessorInitializer.instance) {
            BlockProcessorInitializer.instance = new BlockProcessorInitializer();
        }
        return BlockProcessorInitializer.instance;
    }
    
    /**
     * BlockProcessor sistemini initialize eder
     * @returns Initialized BlockTransactionHandler
     */
    public initialize(): BlockTransactionHandler {
        try {
            logger.info('[BlockProcessorInitializer] Initializing Block Processor system...');
            
            // Storage sınıflarını oluştur
            this.blockStorage = BlockStorage.getInstance();
            this.txStorage = TxStorage.getInstance();
            
            // RPC client'ı al
            this.rpcClient = BabylonClient.getInstance();
            
            // FetcherService'i al
            this.fetcherService = FetcherService.getInstance();
            
            // Processor servisleri oluştur
            this.blockProcessor = new BlockProcessorService(this.blockStorage, this.defaultNetwork);
            
            // FetcherService'i kullanarak tx detaylarını getir
            const fetchTxDetails = async (txHash: string, network?: Network) => {
                // Kullanılan network'ü belirle
                const targetNetwork = network || this.defaultNetwork;
                return this.fetcherService?.fetchTxDetails(txHash, targetNetwork) || null;
            };
            
            this.txProcessor = new TransactionProcessorService(this.txStorage, fetchTxDetails, this.defaultNetwork);
            
            // BlockTransactionHandler'ı initialize et
            this.blockTransactionHandler = BlockTransactionHandler.getInstance();
            this.blockTransactionHandler.initialize(
                this.blockStorage,
                this.txStorage,
                this.blockProcessor,
                this.txProcessor,
                this.rpcClient
            );
            
            // HistoricalSyncService'i al
            this.historicalSyncService = HistoricalSyncService.getInstance();
            
            logger.info('[BlockProcessorInitializer] Block Processor system initialized successfully');
            
            return this.blockTransactionHandler;
        } catch (error) {
            logger.error(`[BlockProcessorInitializer] Error initializing Block Processor system: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * WebSocketMessageService için message processor'ları oluşturur
     * @returns Message processor dizisi
     */
    public createMessageProcessors(): IMessageProcessor[] {
        if (!this.blockTransactionHandler) {
            this.initialize();
        }
        
        if (!this.blockTransactionHandler) {
            throw new Error('[BlockProcessorInitializer] BlockTransactionHandler is not initialized');
        }
        
        return createBlockTxProcessors(this.blockTransactionHandler);
    }
    
    /**
     * Belirli bir ağ için tarihsel verileri senkronize eder
     * @param network Ağ bilgisi (MAINNET, TESTNET)
     * @param fromHeight Başlangıç blok yüksekliği (opsiyonel)
     * @param blockCount Senkronize edilecek blok sayısı (opsiyonel)
     */
    public async startHistoricalSync(
        network: Network,
        fromHeight?: number,
        blockCount?: number
    ): Promise<void> {
        try {
            if (!this.blockTransactionHandler) {
                this.initialize();
            }
            
            // Processor'ların network değerini güncelle
            if (this.blockProcessor) {
                this.blockProcessor.setNetwork(network);
            }
            
            if (this.txProcessor) {
                this.txProcessor.setNetwork(network);
            }
            
            logger.info(`[BlockProcessorInitializer] Starting historical sync for ${network}...`);
            
            // HistoricalSyncService'i kullanarak senkronizasyon yap
            if (!this.historicalSyncService) {
                this.historicalSyncService = HistoricalSyncService.getInstance();
            }
            
            // HistoricalSyncService'in startSync metodunu çağır
            await this.historicalSyncService.startSync(network, fromHeight, blockCount);
            
            logger.info(`[BlockProcessorInitializer] Historical sync completed for ${network}`);
        } catch (error) {
            logger.error(`[BlockProcessorInitializer] Error during historical sync: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * BlockTransactionHandler instance'ını döndürür
     * @returns BlockTransactionHandler instance
     */
    public getBlockTransactionHandler(): BlockTransactionHandler | null {
        return this.blockTransactionHandler;
    }
    
    /**
     * FetcherService instance'ını döndürür
     */
    public getFetcherService(): FetcherService | null {
        if (!this.fetcherService) {
            this.fetcherService = FetcherService.getInstance();
        }
        return this.fetcherService;
    }
    
    /**
     * Default network değerini ayarlar
     */
    public setDefaultNetwork(network: Network): void {
        this.defaultNetwork = network;
    }
} 