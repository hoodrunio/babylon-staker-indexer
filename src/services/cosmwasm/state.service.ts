import { BlockchainTransaction } from '../../database/models/blockchain/Transaction';
import { WasmState, Code, Contract } from '../../database/models/cosmwasm';
import { logger } from '../../utils/logger';
import { CosmWasmClient } from '../../clients/CosmWasmClient';
import { BabylonClient } from '../../clients/BabylonClient';
import { CacheService } from '../CacheService';

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
      const state = await WasmState.getOrCreate(network);
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
          response.models = this.decodeContractStateValues(response.models);
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
          response.models = this.decodeContractStateValues(response.models);
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
          response.entries = this.decodeContractHistoryEntries(response.entries);
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
          response.entries = this.decodeContractHistoryEntries(response.entries);
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
   * Decode contract history entries to provide more readable information
   * @param entries - The history entries to decode
   * @returns Decoded history entries
   */
  private decodeContractHistoryEntries(entries: any[]): any[] {
    return entries.map(entry => {
      try {
        const decodedEntry = { ...entry };
        
        // Decode msg field if available (typically in instantiate, execute, migrate operations)
        if (entry.msg && typeof entry.msg === 'string') {
          try {
            // Try to decode as base64
            const decodedMsg = Buffer.from(entry.msg, 'base64').toString('utf-8');
            
            try {
              // Try to parse as JSON
              decodedEntry.msg = JSON.parse(decodedMsg);
              decodedEntry.raw_msg = entry.msg; // Keep original value
              decodedEntry.decoded = true;
            } catch (jsonError) {
              // Not valid JSON, keep as decoded string
              decodedEntry.msg = decodedMsg;
              decodedEntry.raw_msg = entry.msg; // Keep original value
              decodedEntry.decoded = true;
            }
          } catch (error) {
            // If base64 decoding fails, keep original
            logger.debug(`Failed to decode base64 msg for history entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        // Add human-readable operation type
        if (entry.operation) {
          decodedEntry.operation_type = this.getOperationTypeName(entry.operation);
        }
        
        return decodedEntry;
      } catch (error) {
        logger.error(`Error decoding contract history entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return entry; // Return original on error
      }
    });
  }
  
  /**
   * Get human-readable operation type name from operation code
   * @param operation - The operation code (1-4)
   * @returns Human-readable operation name
   */
  private getOperationTypeName(operation: number): string {
    switch (operation) {
      case 1:
        return 'INSTANTIATE';
      case 2:
        return 'EXECUTE';
      case 3:
        return 'MIGRATE';
      case 4:
        return 'GENESIS';
      default:
        return `UNKNOWN (${operation})`;
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

  /**
   * Decode contract state values from base64 or other formats
   * @param models - The state models to decode
   * @returns Decoded state models
   */
  private decodeContractStateValues(models: any[]): any[] {
    return models.map(model => {
      try {
        const decodedModel = { ...model };
        
        // Decode the key if it's in hex format
        if (model.key && typeof model.key === 'string') {
          try {
            const decodedKey = this.decodeHexKey(model.key);
            if (decodedKey) {
              decodedModel.key_decoded = decodedKey;
            }
          } catch (error) {
            logger.debug(`Failed to decode hex key: ${model.key}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        // Most contract states are base64 encoded
        if (model.value && typeof model.value === 'string') {
          try {
            // Try to decode as base64 and parse as JSON
            const decodedValue = Buffer.from(model.value, 'base64').toString('utf-8');
            
            try {
              // Try to parse as JSON
              const jsonValue = JSON.parse(decodedValue);
              decodedModel.value = jsonValue;
              decodedModel.raw_value = model.value; // Keep original value
              decodedModel.decoded = true;
              
              // Check if this looks like a token balance value
              if (typeof jsonValue === 'string' && /^\d+$/.test(jsonValue)) {
                decodedModel.human_readable_value = this.formatTokenAmount(jsonValue);
              }
            } catch (jsonError) {
              // Not valid JSON, check if it's a number string
              if (/^\d+$/.test(decodedValue)) {
                decodedModel.human_readable_value = this.formatTokenAmount(decodedValue);
              }
              
              decodedModel.value = decodedValue;
              decodedModel.raw_value = model.value; // Keep original value
              decodedModel.decoded = true;
            }
          } catch (error) {
            // If base64 decoding fails, return original
            logger.debug(`Failed to decode base64 value for key ${model.key}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        return decodedModel;
      } catch (error) {
        logger.error(`Error decoding contract state value: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return model; // Return original value on error
      }
    });
  }
  
  /**
   * Decode a hex-encoded key commonly found in CosmWasm contracts
   * @param hexKey - The hex encoded key
   * @returns Decoded key information
   */
  private decodeHexKey(hexKey: string): any {
    // Check if the key is likely a hex string
    if (!/^[0-9a-fA-F]+$/.test(hexKey)) {
      return null;
    }
    
    try {
      // Convert hex to buffer then to utf8
      const buffer = Buffer.from(hexKey, 'hex');
      
      // Some contract keys have a prefix (like 0007) before the actual key
      // We try to find any readable parts in the key
      let readableParts: string[] = [];
      let currentPart = '';
      
      for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i];
        // Check if the byte is a printable ASCII character
        if (byte >= 32 && byte <= 126) {
          currentPart += String.fromCharCode(byte);
        } else if (currentPart.length > 0) {
          readableParts.push(currentPart);
          currentPart = '';
        }
      }
      
      if (currentPart.length > 0) {
        readableParts.push(currentPart);
      }
      
      // Process readable parts to make them more meaningful
      readableParts = this.processReadableParts(readableParts);
      
      // Attempt to identify common key patterns
      const fullString = buffer.toString('utf8', 0, buffer.length).replace(/\0/g, '');
      
      // For CW20 balances, the key typically contains "balance" followed by an address
      const balanceMatch = fullString.match(/balance([a-z0-9]+)/i);
      if (balanceMatch && balanceMatch[1]) {
        const possibleAddress = balanceMatch[1];
        // Check if this looks like a cosmos address (bbn1, cosmos1, etc)
        if (/^[a-z]+1[a-zA-Z0-9]{38,39}$/.test(possibleAddress)) {
          return {
            type: 'cw20_balance',
            address: possibleAddress,
            readable_parts: readableParts,
            decoded_string: fullString
          };
        }
      }
      
      // For token_origin fields
      const tokenOriginMatch = fullString.match(/token_origin([a-z0-9]+)/i);
      if (tokenOriginMatch && tokenOriginMatch[1]) {
        const possibleAddress = tokenOriginMatch[1];
        // Check if this looks like a cosmos address
        if (/^[a-z]+1[a-zA-Z0-9]{38,39}$/.test(possibleAddress)) {
          return {
            type: 'token_origin',
            address: possibleAddress,
            readable_parts: readableParts,
            decoded_string: fullString
          };
        }
      }
      
      // For contract_channels fields
      const contractChannelsMatch = fullString.match(/contract_channels([a-z0-9]+)/i);
      if (contractChannelsMatch && contractChannelsMatch[1]) {
        const possibleAddress = contractChannelsMatch[1];
        // Check if this looks like a cosmos address
        if (/^[a-z]+1[a-zA-Z0-9]{38,39}$/.test(possibleAddress)) {
          return {
            type: 'contract_channels',
            address: possibleAddress,
            readable_parts: readableParts,
            decoded_string: fullString
          };
        }
      }
      
      // For IBC channels
      const channelsMatch = fullString.match(/^channels(\d+)$/i);
      if (channelsMatch && channelsMatch[1]) {
        return {
          type: 'ibc_channel',
          channel_id: parseInt(channelsMatch[1], 10),
          readable_parts: readableParts,
          decoded_string: fullString
        };
      }
      
      // For IBC connections
      const connectionsMatch = fullString.match(/^connections(\d+)$/i);
      if (connectionsMatch && connectionsMatch[1]) {
        return {
          type: 'ibc_connection',
          connection_id: parseInt(connectionsMatch[1], 10),
          readable_parts: readableParts,
          decoded_string: fullString
        };
      }
      
      // For client states
      const clientStatesMatch = fullString.match(/client_states(\d+)$/i);
      if (clientStatesMatch && clientStatesMatch[1]) {
        return {
          type: 'ibc_client_state',
          client_id: parseInt(clientStatesMatch[1], 10),
          readable_parts: readableParts,
          decoded_string: fullString
        };
      }
      
      // For other keys, return as much info as we can
      return {
        readable_parts: readableParts,
        decoded_string: fullString
      };
    } catch (error) {
      logger.debug(`Error decoding hex key: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }
  
  /**
   * Process readable parts to make them more meaningful
   * @param parts - Array of raw readable parts
   * @returns Processed readable parts
   */
  private processReadableParts(parts: string[]): string[] {
    const result: string[] = [];
    
    for (const part of parts) {
      // Extract any known patterns
      
      // Balance pattern: "balanceAddress"
      const balanceMatch = part.match(/^balance([a-z]+1[a-zA-Z0-9]{38,39})$/);
      if (balanceMatch) {
        result.push('balance');
        result.push(balanceMatch[1]);
        continue;
      }
      
      // Token origin pattern: "token_originAddress"
      const tokenOriginMatch = part.match(/^token_origin([a-z]+1[a-zA-Z0-9]{38,39})$/);
      if (tokenOriginMatch) {
        result.push('token_origin');
        result.push(tokenOriginMatch[1]);
        continue;
      }
      
      // Contract channels pattern: "contract_channelsAddress"
      const contractChannelsMatch = part.match(/^contract_channels([a-z]+1[a-zA-Z0-9]{38,39})$/);
      if (contractChannelsMatch) {
        result.push('contract_channels');
        result.push(contractChannelsMatch[1]);
        continue;
      }
      
      // IBC channel pattern: "channelsN"
      const channelsMatch = part.match(/^channels(\d+)$/);
      if (channelsMatch) {
        result.push('channels');
        result.push(`ID: ${channelsMatch[1]}`);
        continue;
      }
      
      // IBC connections pattern: "connectionsN"
      const connectionsMatch = part.match(/^connections(\d+)$/);
      if (connectionsMatch) {
        result.push('connections');
        result.push(`ID: ${connectionsMatch[1]}`);
        continue;
      }
      
      // Client states pattern: "client_statesN"
      const clientStatesMatch = part.match(/^client_states(\d+)$/);
      if (clientStatesMatch) {
        result.push('client_states');
        result.push(`ID: ${clientStatesMatch[1]}`);
        continue;
      }
      
      // Add the part as is if no pattern matched
      result.push(part);
    }
    
    return result;
  }
  
  /**
   * Format a token amount into a human-readable value
   * @param amount - The token amount as a string
   * @returns Formatted token amount
   */
  private formatTokenAmount(amount: string): string {
    try {
      // Token amounts can vary by contract
      // We'll try different common denominations
      const amountBigInt = BigInt(amount);
      
      // Try to determine the likely denomination
      // CW20 tokens in Cosmos often use 6 decimal places
      let denominationFactor = BigInt(10 ** 6);
      
      // For very large numbers, might use different scales
      if (amountBigInt < BigInt(100)) {
        // Small values are likely using different scales
        // e.g., value of "1" might mean 1 token not 0.000001
        if (amountBigInt === BigInt(1)) {
          return "1";
        }
      }
      
      // Major units (whole tokens)
      const major = amountBigInt / denominationFactor;
      // Minor units (fractional tokens)
      const minor = amountBigInt % denominationFactor;
      
      // Format with proper decimal places
      let formattedAmount = major.toString();
      
      if (minor > 0) {
        // Pad minor with leading zeros if needed
        const minorStr = minor.toString().padStart(6, '0');
        // Remove trailing zeros
        const trimmedMinor = minorStr.replace(/0+$/, '');
        
        if (trimmedMinor.length > 0) {
          formattedAmount += '.' + trimmedMinor;
        }
      }
      
      // Also show original amount for clarity
      return `${formattedAmount} (${amount})`;
    } catch (error) {
      logger.debug(`Error formatting token amount: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return amount; // Return original on error
    }
  }
}

// Export a singleton instance
export const cosmWasmStateService = new CosmWasmStateService();
