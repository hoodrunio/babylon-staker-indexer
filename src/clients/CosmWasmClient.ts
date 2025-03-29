import { BaseClient } from './BaseClient';
import { Network } from '../types/finality';
import { logger } from '../utils/logger';

/**
 * Pagination options for CosmWasm API requests
 */
export interface PaginationOptions {
  key?: string;
  offset?: number;
  limit?: number;
  count_total?: boolean;
  reverse?: boolean;
}

/**
 * Client for interacting with CosmWasm-related endpoints
 */
export class CosmWasmClient extends BaseClient {
  /**
   * Create a new CosmWasm client
   */
  constructor(
    network: Network,
    nodeUrl: string,
    rpcUrl: string,
    wsUrl?: string
  ) {
    super(network, nodeUrl, rpcUrl, wsUrl);
  }

  /**
   * Get all codes (Wasm bytecode) from the chain with pagination support
   * @param options Pagination options
   */
  public async getCodes(options?: { pagination: PaginationOptions }): Promise<any> {
    try {
      // Build query parameters for pagination
      const params: Record<string, string> = {};
      
      if (options?.pagination) {
        const { key, offset, limit, count_total, reverse } = options.pagination;
        
        if (key) params['pagination.key'] = key; // Don't encode the key, it's already Base64
        if (offset !== undefined) params['pagination.offset'] = offset.toString();
        if (limit !== undefined) params['pagination.limit'] = limit.toString();
        if (count_total !== undefined) params['pagination.count_total'] = count_total.toString();
        if (reverse !== undefined) params['pagination.reverse'] = reverse.toString();
      }
      
      const response = await this.client.get('/cosmwasm/wasm/v1/code', { params });
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch CosmWasm codes:', error);
      throw error;
    }
  }

  /**
   * Get specific code details by its ID
   * @param codeId The code ID to fetch
   */
  public async getCodeById(codeId: number): Promise<any> {
    try {
      const response = await this.client.get(`/cosmwasm/wasm/v1/code/${codeId}`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch CosmWasm code ID ${codeId}:`, error);
      throw error;
    }
  }

  /**
   * Get all contracts instantiated from a specific code ID with pagination support
   * @param codeId The code ID to fetch contracts for
   * @param options Pagination options
   */
  public async getContractsByCodeId(codeId: number, options?: { pagination: PaginationOptions }): Promise<any> {
    try {
      // Build query parameters for pagination
      const params: Record<string, string> = {};
      
      if (options?.pagination) {
        const { key, offset, limit, count_total, reverse } = options.pagination;
        
        if (key) params['pagination.key'] = key; // Don't encode the key, it's already Base64
        if (offset !== undefined) params['pagination.offset'] = offset.toString();
        if (limit !== undefined) params['pagination.limit'] = limit.toString();
        if (count_total !== undefined) params['pagination.count_total'] = count_total.toString();
        if (reverse !== undefined) params['pagination.reverse'] = reverse.toString();
      }
      
      const response = await this.client.get(`/cosmwasm/wasm/v1/code/${codeId}/contracts`, { params });
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch contracts for code ID ${codeId}:`, error);
      throw error;
    }
  }

  /**
   * Get contract details by its address
   * @param address The contract address to fetch
   */
  public async getContractByAddress(address: string): Promise<any> {
    try {
      const response = await this.client.get(`/cosmwasm/wasm/v1/contract/${address}`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch contract details for address ${address}:`, error);
      throw error;
    }
  }

  /**
   * Get contract history (deploy, migration events) with pagination support
   * @param address The contract address to fetch history for
   * @param options Pagination options
   */
  public async getContractHistory(address: string, options?: { pagination: PaginationOptions }): Promise<any> {
    try {
      // Build query parameters for pagination
      const params: Record<string, string> = {};
      
      if (options?.pagination) {
        const { key, offset, limit, count_total, reverse } = options.pagination;
        
        if (key) params['pagination.key'] = key; // Don't encode the key, it's already Base64
        if (offset !== undefined) params['pagination.offset'] = offset.toString();
        if (limit !== undefined) params['pagination.limit'] = limit.toString();
        if (count_total !== undefined) params['pagination.count_total'] = count_total.toString();
        if (reverse !== undefined) params['pagination.reverse'] = reverse.toString();
      }
      
      const response = await this.client.get(`/cosmwasm/wasm/v1/contract/${address}/history`, { params });
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch contract history for address ${address}:`, error);
      throw error;
    }
  }

  /**
   * Get contract state (optional for storage explorer) with pagination support
   * @param address The contract address to fetch state for
   * @param options Pagination options
   */
  public async getContractState(address: string, options?: { pagination: PaginationOptions }): Promise<any> {
    try {
      // Build query parameters for pagination
      const params: Record<string, string> = {};
      
      if (options?.pagination) {
        const { key, offset, limit, count_total, reverse } = options.pagination;
        
        if (key) params['pagination.key'] = key; // Don't encode the key, it's already Base64
        if (offset !== undefined) params['pagination.offset'] = offset.toString();
        if (limit !== undefined) params['pagination.limit'] = limit.toString();
        if (count_total !== undefined) params['pagination.count_total'] = count_total.toString();
        if (reverse !== undefined) params['pagination.reverse'] = reverse.toString();
      }
      
      const response = await this.client.get(`/cosmwasm/wasm/v1/contract/${address}/state`, { params });
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch contract state for address ${address}:`, error);
      throw error;
    }
  }

  /**
   * Get smart contract query (read-only interaction with a contract)
   * @param address The contract address to query
   * @param queryMsg The query message to send
   */
  public async queryContract(address: string, queryMsg: Record<string, any>): Promise<any> {
    try {
      // Convert query to base64 as required by the API
      const queryBase64 = Buffer.from(JSON.stringify(queryMsg)).toString('base64');
      
      // Use GET request with base64 encoded query as part of the URL
      const response = await this.client.get(`/cosmwasm/wasm/v1/contract/${address}/smart/${queryBase64}`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to query contract at address ${address}:`, error);
      throw error;
    }
  }
}
