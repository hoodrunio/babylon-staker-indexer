import { BlockchainTransaction } from '../../database/models/blockchain/Transaction';
import { WasmState, Contract, Code } from '../../database/models/cosmwasm';
import { logger } from '../../utils/logger';
import { CosmWasmClient } from '../../clients/CosmWasmClient';
import { BabylonClient } from '../../clients/BabylonClient';
import { CacheService } from '../CacheService';
import { cosmWasmDecoderService } from './decoder.service';

/**
 * Interface for pagination options coming from frontend
 */
export interface FrontendPaginationOptions {
  limit: number;
  page: number;
  paginationKey?: string;
}

/**
 * Service for handling CosmWasm state-related operations
 */
export class CosmWasmStateService {
  private cosmWasmClient: CosmWasmClient;
  private cacheService: CacheService;
  private readonly STATE_CACHE_PREFIX = 'cosmwasm:state';
  private readonly HISTORY_CACHE_PREFIX = 'cosmwasm:history';
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor() {
    // Use the existing BabylonClient instead of creating a new one
    const babylonClient = BabylonClient.getInstance();
    this.cosmWasmClient = new CosmWasmClient(
      babylonClient.getNetwork(),
      babylonClient.getBaseUrl(),
      babylonClient.getRpcUrl(),
      babylonClient.getWsEndpoint()
    );
    this.cacheService = CacheService.getInstance();
  }

  /**
   * Get the current state of the CosmWasm indexer
   * @param network - The network ID to get state for
   */
  public async getState(network = 'mainnet'): Promise<any> {
    try {
      // Get the existing state document or create it if it doesn't exist
      const state = await WasmState.getOrCreate(network);
      
      // Get real counts from the database
      const totalCodes = await Code.countDocuments();
      const totalContracts = await Contract.countDocuments();
      
      // Get verified contract count
      const verifiedCodesIds = await Code.find({ verified: true }, { code_id: 1 }).lean();
      const verifiedCodeIds = verifiedCodesIds.map(code => code.code_id);
      const verifiedContractsCount = await Contract.countDocuments({ code_id: { $in: verifiedCodeIds } });
      
      // Update the state with current counts
      if (state.totalCodes !== totalCodes || 
          state.totalContracts !== totalContracts || 
          state.additionalData?.verifiedContractsCount !== verifiedContractsCount) {
        
        state.totalCodes = totalCodes;
        state.totalContracts = totalContracts;
        
        // Initialize additionalData if it doesn't exist
        if (!state.additionalData) {
          state.additionalData = {};
        }
        
        // Update verified contract count
        state.additionalData.verifiedContractsCount = verifiedContractsCount;
        state.updatedAt = new Date();
        await state.save();
      }
      
      return state;
    } catch (error) {
      logger.error('Error fetching CosmWasm state:', error);
      throw new Error('Failed to fetch CosmWasm state');
    }
  }

  /**
   * Get contract state directly from the chain
   * @param contractAddress - The contract address to get state for
   * @param options - Pagination options from frontend
   */
  public async getContractState(
    contractAddress: string, 
    options: FrontendPaginationOptions
  ): Promise<any> {
    try {
      const { page, limit } = options;
      
      // For page 1, we don't need a pagination key
      if (page === 1) {
        // Clear any existing keys for this contract
        await this.cacheService.clearPattern(`${this.STATE_CACHE_PREFIX}:${contractAddress}:*`);
        
        // Make request without pagination key
        const response = await this.requestContractState(contractAddress, limit);
        
        // Cache the next_key for page 2 if available
        if (response.pagination?.next_key) {
          await this.cacheService.set(
            `${this.STATE_CACHE_PREFIX}:${contractAddress}:${page + 1}`,
            response.pagination.next_key,
            this.CACHE_TTL
          );
        }
        
        // Decode state values if they exist
        if (response.models) {
          response.models = cosmWasmDecoderService.decodeContractStateValues(response.models);
        }
        
        // Remove next_key from the response to prevent it from being sent to frontend
        const { next_key, ...paginationWithoutKey } = response.pagination || {};
        
        return {
          ...response,
          pagination: {
            ...paginationWithoutKey,
            has_next: !!next_key
          }
        };
      } else {
        // For subsequent pages, get pagination key from cache
        const cacheKey = `${this.STATE_CACHE_PREFIX}:${contractAddress}:${page}`;
        const paginationKey = await this.cacheService.get<string>(cacheKey);
        
        if (!paginationKey) {
          throw new Error(`Invalid page requested or cache expired. Please start from page 1.`);
        }
        
        // Make request with the cached pagination key
        const response = await this.requestContractState(contractAddress, limit, paginationKey);
        
        // Cache the next_key for the next page if available
        if (response.pagination?.next_key) {
          await this.cacheService.set(
            `${this.STATE_CACHE_PREFIX}:${contractAddress}:${page + 1}`,
            response.pagination.next_key,
            this.CACHE_TTL
          );
        }
        
        // Decode state values if they exist
        if (response.models) {
          response.models = cosmWasmDecoderService.decodeContractStateValues(response.models);
        }
        
        // Remove next_key from the response to prevent it from being sent to frontend
        const { next_key, ...paginationWithoutKey } = response.pagination || {};
        
        return {
          ...response,
          pagination: {
            ...paginationWithoutKey,
            has_next: !!next_key
          }
        };
      }
    } catch (error) {
      logger.error(`Error fetching state for contract ${contractAddress}:`, error);
      throw new Error('Failed to fetch contract state');
    }
  }

  /**
   * Helper method to make the actual state request
   */
  private async requestContractState(
    contractAddress: string, 
    limit: number,
    paginationKey?: string
  ): Promise<any> {
    try {
      // If pagination key is provided, use it
      if (paginationKey) {
        return await this.cosmWasmClient.getContractState(contractAddress, {
          pagination: {
            key: paginationKey,
            limit
          }
        });
      }
      
      // Otherwise, try without pagination parameters first
      try {
        return await this.cosmWasmClient.getContractState(contractAddress);
      } catch (directError: any) {
        // If direct request fails, try with only limit
        logger.debug(`Direct state request failed, trying with limit only: ${directError?.message || 'Unknown error'}`);
        
        return await this.cosmWasmClient.getContractState(contractAddress, {
          pagination: { limit }
        });
      }
    } catch (error) {
      logger.error(`Error in requestContractState for ${contractAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get contract history directly from the chain
   * @param contractAddress - The contract address to get history for
   * @param options - Pagination options from frontend
   */
  public async getContractHistory(
    contractAddress: string, 
    options: FrontendPaginationOptions
  ): Promise<any> {
    try {
      const { page, limit } = options;
      
      // For page 1, we don't need a pagination key
      if (page === 1) {
        // Clear any existing keys for this contract
        await this.cacheService.clearPattern(`${this.HISTORY_CACHE_PREFIX}:${contractAddress}:*`);
        
        // Make request without pagination key
        const response = await this.requestContractHistory(contractAddress, limit);
        
        // Cache the next_key for page 2 if available
        if (response.pagination?.next_key) {
          await this.cacheService.set(
            `${this.HISTORY_CACHE_PREFIX}:${contractAddress}:${page + 1}`,
            response.pagination.next_key,
            this.CACHE_TTL
          );
        }
        
        // Decode history entries if they exist
        if (response.entries) {
          response.entries = cosmWasmDecoderService.decodeContractHistoryEntries(response.entries);
        }
        
        // Remove next_key from the response to prevent it from being sent to frontend
        const { next_key, ...paginationWithoutKey } = response.pagination || {};
        
        return {
          ...response,
          pagination: {
            ...paginationWithoutKey,
            has_next: !!next_key
          }
        };
      } else {
        // For subsequent pages, get pagination key from cache
        const cacheKey = `${this.HISTORY_CACHE_PREFIX}:${contractAddress}:${page}`;
        const paginationKey = await this.cacheService.get<string>(cacheKey);
        
        if (!paginationKey) {
          throw new Error(`Invalid page requested or cache expired. Please start from page 1.`);
        }
        
        // Make request with the cached pagination key
        const response = await this.requestContractHistory(contractAddress, limit, paginationKey);
        
        // Cache the next_key for the next page if available
        if (response.pagination?.next_key) {
          await this.cacheService.set(
            `${this.HISTORY_CACHE_PREFIX}:${contractAddress}:${page + 1}`,
            response.pagination.next_key,
            this.CACHE_TTL
          );
        }
        
        // Decode history entries if they exist
        if (response.entries) {
          response.entries = cosmWasmDecoderService.decodeContractHistoryEntries(response.entries);
        }
        
        // Remove next_key from the response to prevent it from being sent to frontend
        const { next_key, ...paginationWithoutKey } = response.pagination || {};
        
        return {
          ...response,
          pagination: {
            ...paginationWithoutKey,
            has_next: !!next_key
          }
        };
      }
    } catch (error) {
      logger.error(`Error fetching history for contract ${contractAddress}:`, error);
      throw new Error('Failed to fetch contract history');
    }
  }

  /**
   * Helper method to make the actual history request
   */
  private async requestContractHistory(
    contractAddress: string, 
    limit: number,
    paginationKey?: string
  ): Promise<any> {
    try {
      // If pagination key is provided, use it
      if (paginationKey) {
        return await this.cosmWasmClient.getContractHistory(contractAddress, {
          pagination: {
            key: paginationKey,
            limit
          }
        });
      }
      
      // Otherwise, try without pagination parameters first
      try {
        return await this.cosmWasmClient.getContractHistory(contractAddress);
      } catch (directError: any) {
        // If direct request fails, try with only limit
        logger.debug(`Direct history request failed, trying with limit only: ${directError?.message || 'Unknown error'}`);
        
        return await this.cosmWasmClient.getContractHistory(contractAddress, {
          pagination: { limit }
        });
      }
    } catch (error) {
      logger.error(`Error in requestContractHistory for ${contractAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get transaction history for a specific contract
   * @param contractAddress - The contract address to get history for
   * @param limit - Number of transactions to return
   * @param skip - Number of transactions to skip
   */
  public async getContractTransactions(contractAddress: string, limit = 10, skip = 0): Promise<any> {
    try {
      // Create a more optimized query with proper projection and lean() for better performance
      const transactions = await BlockchainTransaction.find(
        { 'meta.content.contract': contractAddress },
        { 
          txHash: 1, 
          time: 1, 
          status: 1, 
          firstMessageType: 1, 
          type: 1, 
          fee: 1, 
          height: 1,
          meta: 1 // We still need meta for amount extraction
        }
      )
        .sort({ time: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .lean(); // Convert to plain JS objects for better performance
      
      // Use countDocuments with a hint to use the proper index
      const totalCount = await BlockchainTransaction.countDocuments(
        { 'meta.content.contract': contractAddress }
      ).hint({ 'meta.content.contract': 1, time: -1 });
      
      return {
        transactions: transactions.map(tx => ({
          txHash: tx.txHash,
          timestamp: tx.time,
          result: tx.status,
          messageType: tx.firstMessageType || tx.type,
          amount: this.extractAmountFromTransaction(tx),
          fee: tx.fee,
          height: tx.height
        })),
        pagination: {
          total: totalCount,
          limit: Number(limit),
          skip: Number(skip)
        }
      };
    } catch (error) {
      logger.error(`Error fetching transaction history for contract ${contractAddress}:`, error);
      throw new Error('Failed to fetch contract transaction history');
    }
  }

  /**
   * Get transaction history for a specific code ID
   * This queries all contracts related to the code ID and then finds transactions for those contracts
   * @param codeId - The code ID to get transaction history for
   * @param limit - Number of transactions to return
   * @param skip - Number of transactions to skip
   */
  public async getCodeTransactions(codeId: number, limit = 10, skip = 0): Promise<any> {
    try {
      // First, get only the contract addresses related to this code ID
      // Use projection and lean() for better performance
      const contracts = await Contract.find(
        { code_id: codeId },
        { contract_address: 1 }
      ).lean();
      
      if (!contracts || contracts.length === 0) {
        return {
          transactions: [],
          pagination: {
            total: 0,
            limit: Number(limit),
            skip: Number(skip)
          }
        };
      }
      
      // Get the contract addresses
      const contractAddresses = contracts.map(contract => contract.contract_address);
      
      // Use a more efficient approach with find() instead of aggregation
      // Only request the fields we need
      const transactions = await BlockchainTransaction.find(
        { 'meta.content.contract': { $in: contractAddresses } },
        {
          txHash: 1,
          time: 1,
          status: 1,
          firstMessageType: 1,
          type: 1,
          fee: 1,
          height: 1,
          meta: 1 // Still needed for extracting contract and amount
        }
      )
        .sort({ time: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .lean(); // Convert to plain JS objects for better performance
      
      // Use more efficient count method with explicit index hint if available
      let totalCountQuery = BlockchainTransaction.countDocuments({
        'meta.content.contract': { $in: contractAddresses }
      });
      
      // Try to use index hint, but wrap in try/catch in case the index doesn't exist
      try {
        totalCountQuery = totalCountQuery.hint({ 'meta.content.contract': 1 });
      } catch (err) {
        logger.warn('Index hint not available for meta.content.contract, using default index');
      }
      
      const totalCount = await totalCountQuery;
      
      return {
        transactions: transactions.map(tx => ({
          txHash: tx.txHash,
          timestamp: tx.time,
          result: tx.status,
          messageType: tx.firstMessageType || tx.type,
          amount: this.extractAmountFromTransaction(tx),
          fee: tx.fee,
          height: tx.height,
          contractAddress: this.extractContractFromTransaction(tx)
        })),
        pagination: {
          total: totalCount,
          limit: Number(limit),
          skip: Number(skip)
        }
      };
    } catch (error) {
      logger.error(`Error fetching transaction history for code ID ${codeId}:`, error);
      throw new Error('Failed to fetch code transaction history');
    }
  }

  /**
   * Helper method to extract amount information from a transaction
   * @param tx - The transaction object
   * @returns The amount information or null
   */
  private extractAmountFromTransaction(tx: any): any {
    try {
      // Check for amount in different message types
      if (tx.meta && tx.meta.length > 0) {
        for (const msg of tx.meta) {
          if (msg.content && msg.content.amount) {
            return msg.content.amount;
          }
          if (msg.content && msg.content.funds) {
            return msg.content.funds;
          }
        }
      }
      return null;
    } catch (error) {
      logger.error('Error extracting amount from transaction:', error);
      return null;
    }
  }

  /**
   * Helper method to extract contract address from a transaction
   * @param tx - The transaction object
   * @returns The contract address or null
   */
  private extractContractFromTransaction(tx: any): string | null {
    try {
      if (tx.meta && tx.meta.length > 0) {
        for (const msg of tx.meta) {
          if (msg.content && msg.content.contract) {
            return msg.content.contract;
          }
        }
      }
      return null;
    } catch (error) {
      logger.error('Error extracting contract from transaction:', error);
      return null;
    }
  }
}

// Export a singleton instance
export const cosmWasmStateService = new CosmWasmStateService();
