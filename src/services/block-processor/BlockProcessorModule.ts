/**
 * Block Processor Module
 * Blok işleme sisteminin ana giriş noktası
 */

import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { BlockProcessorInitializer } from './integration/BlockProcessorInitializer';
import { BlockTransactionHandler } from './handlers/BlockTransactionHandler';
import { IMessageProcessor } from '../websocket/interfaces';

/**
 * Blok işleme sisteminin ana modülü
 * Bu sınıf, blok işleme sisteminin tüm bileşenlerini yönetir ve dış dünya ile iletişim kurar
 */
export class BlockProcessorModule {
    private static instance: BlockProcessorModule | null = null;
    private initializer: BlockProcessorInitializer;
    private isInitialized: boolean = false;
    
    private constructor() {
        this.initializer = BlockProcessorInitializer.getInstance();
    }
    
    /**
     * Singleton instance
     */
    public static getInstance(): BlockProcessorModule {
        if (!BlockProcessorModule.instance) {
            BlockProcessorModule.instance = new BlockProcessorModule();
        }
        return BlockProcessorModule.instance;
    }
    
    /**
     * Modülü başlatır
     */
    public initialize(): void {
        if (this.isInitialized) {
            logger.info('[BlockProcessorModule] Module is already initialized');
            return;
        }
        
        try {
            logger.info('[BlockProcessorModule] Initializing Block Processor Module...');
            
            // BlockProcessorInitializer'ı kullanarak sistemi başlat
            this.initializer.initialize();
            this.isInitialized = true;
            
            logger.info('[BlockProcessorModule] Block Processor Module initialized successfully');
        } catch (error) {
            logger.error(`[BlockProcessorModule] Error initializing Block Processor Module: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * WebSocketMessageService için message processor'ları döndürür
     */
    public getMessageProcessors(): IMessageProcessor[] {
        if (!this.isInitialized) {
            this.initialize();
        }
        
        return this.initializer.createMessageProcessors();
    }
    
    /**
     * BlockTransactionHandler instance'ını döndürür
     */
    public getBlockTransactionHandler(): BlockTransactionHandler {
        if (!this.isInitialized) {
            this.initialize();
        }
        
        const handler = this.initializer.getBlockTransactionHandler();
        if (!handler) {
            throw new Error('[BlockProcessorModule] BlockTransactionHandler is not initialized');
        }
        
        return handler;
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
        if (!this.isInitialized) {
            this.initialize();
        }
        
        await this.initializer.startHistoricalSync(network, fromHeight, blockCount);
    }
} 