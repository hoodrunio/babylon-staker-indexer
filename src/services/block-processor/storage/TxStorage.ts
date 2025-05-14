/**
 * Transaction Storage Service
 * Stores transaction data in the database
 */

import { BaseTx, PaginatedTxsResponse } from '../types/common';
import { ITxStorage } from '../types/interfaces';
import { logger } from '../../../utils/logger';
import { Network } from '../../../types/finality';
import { TxService } from '../transaction/service/TxService';
import { ITxService } from '../transaction/service/ITxService';

/**
 * Service for storing transaction data
 * This class is a facade for the new modular transaction services
 */
export class TxStorage implements ITxStorage {
    private static instance: TxStorage | null = null;
    private txService: ITxService;
    
    private constructor() {
        // Private constructor to enforce singleton pattern
        this.txService = TxService.getInstance();
    }
    
    /**
     * Format error message consistently
     */
    private formatError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    /**
     * Singleton instance
     */
    public static getInstance(): TxStorage {
        if (!TxStorage.instance) {
            TxStorage.instance = new TxStorage();
        }
        return TxStorage.instance;
    }

    /**
     * Migrates existing transactions to add firstMessageType field
     * This is a one-time operation to update existing records
     */
    public async migrateExistingTransactions(network: Network): Promise<void> {
        try {
            await this.txService.migrateExistingTransactions(network);
        } catch (error) {
            logger.error(`[TxStorage] Error migrating transactions: ${this.formatError(error)}`);
            throw error;
        }
    }

    /**
     * Saves transaction to database
     */
    public async saveTx(tx: BaseTx, network: Network): Promise<void> {
        try {
            await this.txService.saveTx(tx, network);
        } catch (error) {
            logger.error(`[TxStorage] Error saving transaction to database: ${this.formatError(error)}`);
            throw error;
        }
    }

    /**
     * Gets transaction by hash from database or blockchain
     * If useRawFormat is true, always fetches from blockchain regardless of database presence
     * If not found in database and fetcherService is available, tries to fetch from blockchain
     * @param txHash Transaction hash
     * @param network Network type
     * @param useRawFormat If true, returns raw transaction data from blockchain
     * @returns Transaction data or null if not found
     */
    public async getTxByHash(txHash: string, network: Network, useRawFormat: boolean = false): Promise<BaseTx | any | null> {
        try {
            return await this.txService.getTxByHash(txHash, network, useRawFormat);
        } catch (error) {
            logger.error(`[TxStorage] Error getting transaction by hash from database: ${this.formatError(error)}`);
            return null;
        }
    }

    /**
     * Gets all transactions at a specific height from the database or blockchain
     * If useRawFormat is true, always fetches from blockchain regardless of database presence
     * If no transactions found and fetcherService is available, tries to fetch from blockchain
     * @param height Block height
     * @param network Network type
     * @param useRawFormat If true, returns raw transaction data from blockchain
     * @returns Array of transactions
     */
    public async getTxsByHeight(height: string | number, network: Network, useRawFormat: boolean = false): Promise<BaseTx[] | any[]> {
        try {
            return await this.txService.getTxsByHeight(height, network, useRawFormat);
        } catch (error) {
            logger.error(`[TxStorage] Error getting transactions by height from database: ${this.formatError(error)}`);
            return [];
        }
    }

    /**
     * Gets total transaction count from database
     */
    public async getTxCount(network: Network): Promise<number> {
        try {
            return await this.txService.getTxCount(network);
        } catch (error) {
            logger.error(`[TxStorage] Error getting transaction count from database: ${this.formatError(error)}`);
            return 0;
        }
    }

    /**
     * Gets latest transactions with pagination
     * @param network Network type
     * @param page Page number (1-based, default: 1)
     * @param limit Number of transactions per page (default: 50)
     * @param cursor Optional cursor for optimized pagination
     * @returns Paginated transactions response
     */
    public async getLatestTransactions(
        network: Network,
        page: number = 1,
        limit: number = 50,
        cursor: string | null = null
    ): Promise<PaginatedTxsResponse> {
        try {
            return await this.txService.getLatestTransactions(network, page, limit, cursor);
        } catch (error) {
            logger.error(`[TxStorage] Error getting latest transactions: ${this.formatError(error)}`);
            throw error;
        }
    }
}