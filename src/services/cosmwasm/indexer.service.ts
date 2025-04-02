import { CosmWasmClient } from '../../clients/CosmWasmClient';
import { Code, Contract, WasmState } from '../../database/models/cosmwasm';
import { logger } from '../../utils/logger';
import { BabylonClient } from '../../clients/BabylonClient';
import { QueryMethodExtractor } from './query-extractor.service';

/**
 * Interface for code info returned from the chain
 */
interface CodeInfo {
  code_id: string;
  creator: string;
  data_hash: string;
  created?: {
    at: string;
  };
  instantiate_permission?: {
    permission: string;
    addresses: string[];
  };
}

// CosmWasm State document ID
const WASM_STATE_ID = 'cosmwasm_state';

/**
 * Service for indexing CosmWasm data from the blockchain
 */
export class CosmWasmIndexerService {
  private readonly client: CosmWasmClient;
  private readonly queryExtractor: QueryMethodExtractor;
  private static instance: CosmWasmIndexerService | null = null;

  /**
   * Initialize CosmWasm indexer
   */
  private constructor() {
    // Use the existing BabylonClient instead of creating a new one
    const babylonClient = BabylonClient.getInstance();
    this.client = new CosmWasmClient(
      babylonClient.getNetwork(),
      babylonClient.getBaseUrl(),
      babylonClient.getRpcUrl(),
      babylonClient.getWsEndpoint()
    );
    this.queryExtractor = new QueryMethodExtractor(this.client);
  }

  /**
   * Get singleton instance of CosmWasmIndexerService
   */
  public static getInstance(): CosmWasmIndexerService {
    if (!CosmWasmIndexerService.instance) {
      CosmWasmIndexerService.instance = new CosmWasmIndexerService();
    }
    return CosmWasmIndexerService.instance;
  }

  /**
   * Index all CosmWasm codes and contracts with pagination support
   */
  public async indexAllCosmWasmData(): Promise<void> {
    try {
      logger.info('Starting CosmWasm data indexing process');
      
      const startTime = Date.now();
      
      // Index all codes with pagination
      await this.indexAllCodes();
      
      // Get total statistics
      const totalCodes = await Code.countDocuments();
      const totalContracts = await Contract.countDocuments();
      
      // Update WasmState
      await this.updateWasmState({
        lastFullIndexAt: new Date(),
        totalCodes,
        totalContracts
      });
      
      const duration = (Date.now() - startTime) / 1000;
      logger.info(`Completed CosmWasm data indexing in ${duration.toFixed(2)} seconds. Total: ${totalCodes} codes, ${totalContracts} contracts`);
    } catch (error) {
      logger.error('Error indexing CosmWasm data:', error);
      throw error;
    }
  }

  /**
   * Index all codes with pagination support
   * @param pageLimit Number of items per page (default: 100)
   */
  private async indexAllCodes(pageLimit: number = 100): Promise<void> {
    let nextKey: string | null = null;
    let totalIndexed = 0;
    let pageCount = 0;

    do {
      try {
        // Fetch a page of codes from the chain
        const response = await this.client.getCodes({
          pagination: {
            key: nextKey || undefined,
            limit: pageLimit,
            reverse: true
          }
        });

        const chainCodes = response?.code_infos || [];
        const paginationResponse = response?.pagination || {};
        
        // Update nextKey for next iteration
        nextKey = paginationResponse.next_key || null;
        pageCount++;
        
        logger.info(`Fetched ${chainCodes.length} codes from chain (page: ${pageCount}, key: ${nextKey || 'end'})`);
        
        // If we receive an empty code_infos array and there is a next_key value, this might be an API inconsistency
        if (chainCodes.length === 0 && nextKey) {
          logger.warn(`Received empty code_infos array with pagination.next_key: ${nextKey}. Breaking to prevent infinite loop.`);
          break;
        }
        
        // If we receive an empty code_infos array and there is no next_key value, this means it is the last page
        if (chainCodes.length === 0 && !nextKey) {
          logger.info(`No more codes to process. Ending indexing.`);
          break;
        }
        
        // Process codes in parallel batches
        const processingPromises = chainCodes.map(async (codeInfo: CodeInfo) => {
          const codeId = parseInt(codeInfo.code_id);
          await this.processCode(codeId, codeInfo);
        });
        
        await Promise.all(processingPromises);
        
        totalIndexed += chainCodes.length;
        logger.info(`Processed ${totalIndexed} codes so far (current page: ${pageCount})`);
        
      } catch (error) {
        logger.error('Error fetching codes page:', error);
        // Break the loop on error
        nextKey = null;
      }
    } while (nextKey);
    
    logger.info(`Completed indexing ${totalIndexed} total codes across ${pageCount} pages`);
  }

  /**
   * Process a single code and its contracts
   * @param codeId The code ID to process
   * @param codeInfo Optional code info if already fetched
   */
  private async processCode(codeId: number, codeInfo?: CodeInfo): Promise<void> {
    try {
      // Check if we already have this code in our database
      const existingCode = await Code.findOne({ code_id: codeId });
      
      if (!existingCode) {
        // Get detailed code info if not provided
        if (!codeInfo) {
          const codeDetailsResponse = await this.client.getCodeById(codeId);
          codeInfo = codeDetailsResponse?.code_info;
        }
        
        if (codeInfo) {
          // Save code to database
          const newCode = new Code({
            code_id: codeId,
            creator: codeInfo.creator,
            checksum: codeInfo.data_hash,
            created_at: new Date(codeInfo.created?.at || Date.now()),
            verified: false,
            instantiate_permission: codeInfo.instantiate_permission || {
              permission: 'Everybody',
              addresses: []
            }
          });
          
          await newCode.save();
          logger.info(`Indexed new CosmWasm code: ${codeId}`);
        }
      }
      
      // Now index contracts for this code with pagination
      await this.indexContractsForCode(codeId);
      
    } catch (error) {
      logger.error(`Error processing code ${codeId}:`, error);
      // Don't throw to allow other codes to be processed
    }
  }

  /**
   * Index all contracts for a specific code with pagination support
   * @param codeId The code ID to index contracts for
   * @param pageLimit Number of items per page (default: 100)
   */
  private async indexContractsForCode(codeId: number, pageLimit: number = 100): Promise<void> {
    let nextKey: string | null = null;
    let totalIndexed = 0;
    let newContractsCount = 0;
    let pageCount = 0;

    do {
      try {
        // Fetch a page of contracts for this code
        const response = await this.client.getContractsByCodeId(codeId, {
          pagination: {
            key: nextKey || undefined,
            limit: pageLimit
          }
        });

        const contracts = response?.contracts || [];
        const paginationResponse = response?.pagination || {};
        
        // Update nextKey for next iteration
        nextKey = paginationResponse.next_key || null;
        pageCount++;
        
        logger.info(`Fetched ${contracts.length} contracts for code ${codeId} (page: ${pageCount}, key: ${nextKey || 'end'})`);
        
        // If we receive an empty contracts array and there is a next_key value, this might be an API inconsistency
        if (contracts.length === 0 && nextKey) {
          logger.warn(`Received empty contracts array for code ${codeId} with pagination.next_key: ${nextKey}. Breaking to prevent infinite loop.`);
          break;
        }
        
        // If we receive an empty contracts array and there is no next_key value, this means it is the last page
        if (contracts.length === 0 && !nextKey) {
          logger.info(`No more contracts to process for code ${codeId}. Ending indexing.`);
          break;
        }
        
        // Process contracts in parallel batches
        const processingPromises = contracts.map(async (contractAddress: string) => {
          const result = await this.processContract(contractAddress, codeId);
          if (result) newContractsCount++;
        });
        
        await Promise.all(processingPromises);
        
        totalIndexed += contracts.length;
        
      } catch (error) {
        logger.error(`Error fetching contracts page for code ${codeId}:`, error);
        // Break the loop on error
        nextKey = null;
      }
    } while (nextKey);
    
    // Update contract count in the Code document
    if (newContractsCount > 0) {
      await Code.findOneAndUpdate(
        { code_id: codeId },
        { $inc: { contract_count: newContractsCount } }
      );
      logger.info(`Updated contract count for code ${codeId} (+${newContractsCount})`);
    }
    
    // Ensure the contract count matches the actual number of contracts
    const dbCount = await Contract.countDocuments({ code_id: codeId });
    await Code.findOneAndUpdate(
      { code_id: codeId },
      { contract_count: dbCount }
    );
    
    logger.info(`Completed indexing ${totalIndexed} contracts for code ${codeId} across ${pageCount} pages`);
  }

  /**
   * Process a single contract
   * @param contractAddress The contract address to process
   * @param codeId The code ID of the contract
   * @returns true if a new contract was created, false otherwise
   */
  private async processContract(contractAddress: string, codeId: number): Promise<boolean> {
    try {
      // Skip if we already have this contract in our database
      const existingContract = await Contract.findOne({ contract_address: contractAddress });
      
      if (existingContract) {
        // Check if we need to update the latest migration code ID
        if (existingContract.code_id !== codeId && !existingContract.latest_migration_code_id) {
          existingContract.latest_migration_code_id = codeId;
          await existingContract.save();
          logger.info(`Updated migration code ID for contract ${contractAddress}: ${codeId}`);
        }
        
        // Don't extract query methods for existing contracts
        return false;
      }
      
      // Get contract details
      const contractDetailsResponse = await this.client.getContractByAddress(contractAddress);
      const contractDetails = contractDetailsResponse?.contract_info;
      
      if (!contractDetails) {
        logger.warn(`Could not fetch details for contract ${contractAddress}`);
        return false;
      }
      
      // Get contract history to find init message
      const historyResponse = await this.client.getContractHistory(contractAddress);
      const historyEntries = historyResponse?.entries || [];
      
      // Find the instantiate entry to get the init message
      const instantiateEntry = historyEntries.find(
        (entry: { operation: string; msg?: string }) => entry.operation === 'CONTRACT_INSTANTIATE'
      );
      
      // Find migration entries to track the latest migration
      const migrateEntries = historyEntries.filter(
        (entry: { operation: string }) => entry.operation === 'CONTRACT_MIGRATE'
      );
      
      let latestMigrationCodeId = null;
      if (migrateEntries.length > 0) {
        // Sort by timestamp if available, or assume the last entry is the most recent
        migrateEntries.sort((a: any, b: any) => {
          if (a.time && b.time) {
            return new Date(b.time).getTime() - new Date(a.time).getTime();
          }
          return 0; // Keep original order if no timestamps
        });
        
        latestMigrationCodeId = parseInt(migrateEntries[0].code_id || codeId);
      }
      
      let initMsg = {};
      
      if (instantiateEntry?.msg) {
        try {
          // Try to parse the init message if it's base64 encoded
          const msgStr = Buffer.from(instantiateEntry.msg, 'base64').toString();
          initMsg = JSON.parse(msgStr);
        } catch (error) {
          logger.warn(`Could not parse init message for contract ${contractAddress}:`, error);
          // Use the raw msg if parsing fails
          initMsg = instantiateEntry.msg || {};
        }
      }
      
      // Extract query methods for the new contract
      const methods = await this.queryExtractor.extractQueryMethods(contractAddress);
      
      // Save contract to database
      const newContract = new Contract({
        contract_address: contractAddress,
        code_id: codeId,
        label: contractDetails.label,
        admin: contractDetails.admin,
        init_msg: initMsg,
        created: contractDetails.created || null,
        created_at: new Date(contractDetails.created?.at || Date.now()),
        latest_migration_code_id: latestMigrationCodeId,
        query_methods: methods || [] // Save extracted methods or empty array if extraction failed
      });
      
      await newContract.save();
      logger.info(`Indexed new CosmWasm contract: ${contractAddress}`);
      
      return true;
    } catch (error) {
      logger.error(`Error processing contract ${contractAddress}:`, error);
      return false;
    }
  }

  /**
   * Update WasmState with the provided data
   */
  private async updateWasmState(data: Partial<{
    lastFullIndexAt: Date;
    lastIncrementalIndexAt: Date;
    totalCodes: number;
    totalContracts: number;
    additionalData: Record<string, any>;
  }>): Promise<void> {
    try {
      // Get or create the WasmState document
      const state = await WasmState.getOrCreate(WASM_STATE_ID);
      
      // Update fields
      if (data.lastFullIndexAt) {
        state.lastFullIndexAt = data.lastFullIndexAt;
      }
      
      if (data.lastIncrementalIndexAt) {
        state.lastIncrementalIndexAt = data.lastIncrementalIndexAt;
      }
      
      if (data.totalCodes !== undefined) {
        state.totalCodes = data.totalCodes;
      }
      
      if (data.totalContracts !== undefined) {
        state.totalContracts = data.totalContracts;
      }
      
      if (data.additionalData) {
        state.additionalData = { 
          ...state.additionalData,
          ...data.additionalData
        };
      }
      
      state.updatedAt = new Date();
      
      // Save changes
      await state.save();
    } catch (error) {
      logger.error('Error updating WasmState:', error);
    }
  }

  /**
   * Index only contracts that might have changed since last indexing
   * This is an optimization for incremental indexing to reduce load
   */
  public async indexContractChanges(): Promise<void> {
    try {
      logger.info('Starting incremental CosmWasm contracts indexing');
      
      const startTime = Date.now();
      
      // First, let's check the latest code ID on the chain
      const latestCodeResponse = await this.client.getCodes({
        pagination: {
          limit: 1,
          reverse: true // We reverse the order to get the latest code
        }
      });
      
      let newCodesIndexed = 0;
      
      if (latestCodeResponse?.code_infos && latestCodeResponse.code_infos.length > 0) {
        // The latest code ID on the chain
        const latestChainCodeId = parseInt(latestCodeResponse.code_infos[0].code_id);
        
        // The latest code ID in our database
        const latestDbCode = await Code.findOne().sort({ code_id: -1 }).limit(1);
        const latestDbCodeId = latestDbCode ? latestDbCode.code_id : 0;
        
        // If there are new codes on the chain, let's index them
        if (latestChainCodeId > latestDbCodeId) {
          logger.info(`Found new codes on chain: ${latestDbCodeId + 1} to ${latestChainCodeId}`);
          
          // Let's index the new codes
          for (let codeId = latestDbCodeId + 1; codeId <= latestChainCodeId; codeId++) {
            try {
              await this.processCode(codeId);
              newCodesIndexed++;
            } catch (error) {
              logger.error(`Error indexing new code ${codeId}:`, error);
              // Let's continue with the other codes
            }
          }
          
          logger.info(`Indexed ${newCodesIndexed} new codes`);
        }
      }
      
      // Fetch all existing codes from our database
      const existingCodes = await Code.find({});
      
      // Index all contracts for existing codes only (without rechecking code details)
      let indexedContracts = 0;
      
      for (const code of existingCodes) {
        try {
          // Count the previous contract count
          const previousCount = await Contract.countDocuments({ code_id: code.code_id });
          
          // Re-index contracts for this code
          await this.indexContractsForCode(code.code_id);
          
          // Count the new contract count
          const newCount = await Contract.countDocuments({ code_id: code.code_id });
          
          // Calculate how many new contracts were added
          const addedContracts = newCount - previousCount;
          if (addedContracts > 0) {
            indexedContracts += addedContracts;
            logger.info(`Added ${addedContracts} new contracts for code ${code.code_id}`);
          }
        } catch (error) {
          logger.error(`Error indexing contracts for code ${code.code_id}:`, error);
          // Continue with other codes
        }
      }
      
      // Get total statistics
      const totalCodes = await Code.countDocuments();
      const totalContracts = await Contract.countDocuments();
      
      // Update WasmState
      await this.updateWasmState({
        lastIncrementalIndexAt: new Date(),
        totalCodes,
        totalContracts,
        additionalData: {
          lastIndexedContracts: indexedContracts,
          lastIndexedCodes: newCodesIndexed
        }
      });
      
      const duration = (Date.now() - startTime) / 1000;
      logger.info(`Completed incremental CosmWasm indexing in ${duration.toFixed(2)} seconds (${newCodesIndexed} new codes, ${indexedContracts} new contracts)`);
    } catch (error) {
      logger.error('Error during incremental CosmWasm indexing:', error);
      throw error;
    }
  }
}
