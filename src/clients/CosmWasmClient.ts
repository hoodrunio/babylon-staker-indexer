import { BaseClient } from './BaseClient';
import { Network } from '../types/finality';
import { logger } from '../utils/logger';

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
   * Get all codes (Wasm bytecode) from the chain
   */
  public async getCodes(): Promise<any> {
    try {
      const response = await this.client.get('/cosmwasm/wasm/v1/code');
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch CosmWasm codes:', error);
      throw error;
    }
  }

  /**
   * Get specific code details by its ID
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
   * Get all contracts instantiated from a specific code ID
   */
  public async getContractsByCodeId(codeId: number): Promise<any> {
    try {
      const response = await this.client.get(`/cosmwasm/wasm/v1/code/${codeId}/contracts`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch contracts for code ID ${codeId}:`, error);
      throw error;
    }
  }

  /**
   * Get contract details by its address
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
   * Get contract history (deploy, migration events)
   */
  public async getContractHistory(address: string): Promise<any> {
    try {
      const response = await this.client.get(`/cosmwasm/wasm/v1/contract/${address}/history`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch contract history for address ${address}:`, error);
      throw error;
    }
  }

  /**
   * Get contract state (optional for storage explorer)
   */
  public async getContractState(address: string): Promise<any> {
    try {
      const response = await this.client.get(`/cosmwasm/wasm/v1/contract/${address}/state`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch contract state for address ${address}:`, error);
      throw error;
    }
  }

  /**
   * Get smart contract query (read-only interaction with a contract)
   */
  public async queryContract(address: string, queryMsg: Record<string, any>): Promise<any> {
    try {
      const response = await this.client.post(`/cosmwasm/wasm/v1/contract/${address}/smart`, {
        query_data: Buffer.from(JSON.stringify(queryMsg)).toString('base64')
      });
      return response.data;
    } catch (error) {
      logger.error(`Failed to query contract at address ${address}:`, error);
      throw error;
    }
  }
}
