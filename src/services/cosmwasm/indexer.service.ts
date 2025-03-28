import { CosmWasmClient } from '../../clients/CosmWasmClient';
import { Code, Contract } from '../../database/models/cosmwasm';
import { logger } from '../../utils/logger';
import { IndexerState } from '../../database/models/IndexerState';
import { BabylonClient } from '../../clients/BabylonClient';

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
}

/**
 * Service for indexing CosmWasm data from the blockchain
 */
export class CosmWasmIndexerService {
  private readonly client: CosmWasmClient;
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
      
      // Index all codes with pagination
      await this.indexAllCodes();
      
      // Update indexer state
      await this.updateIndexerState();
      
      logger.info('Completed CosmWasm data indexing');
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

    do {
      try {
        // Fetch a page of codes from the chain
        const response = await this.client.getCodes({
          pagination: {
            key: nextKey || undefined,
            limit: pageLimit
          }
        });

        const chainCodes = response?.code_infos || [];
        const paginationResponse = response?.pagination || {};
        
        // Update nextKey for next iteration
        nextKey = paginationResponse.next_key || null;
        
        logger.info(`Fetched ${chainCodes.length} codes from chain (page key: ${nextKey || 'end'})`);
        
        // Process codes in parallel batches
        const processingPromises = chainCodes.map(async (codeInfo: CodeInfo) => {
          const codeId = parseInt(codeInfo.code_id);
          await this.processCode(codeId, codeInfo);
        });
        
        await Promise.all(processingPromises);
        
        totalIndexed += chainCodes.length;
        logger.info(`Processed ${totalIndexed} codes so far`);
        
      } catch (error) {
        logger.error('Error fetching codes page:', error);
        // Break the loop on error
        nextKey = null;
      }
    } while (nextKey);
    
    logger.info(`Completed indexing ${totalIndexed} total codes`);
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
            data_hash: codeInfo.data_hash,
            created_at: new Date(codeInfo.created?.at || Date.now()),
            verified: false
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
        
        logger.info(`Fetched ${contracts.length} contracts for code ${codeId} (page key: ${nextKey || 'end'})`);
        
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
    
    logger.info(`Completed indexing ${totalIndexed} contracts for code ${codeId}`);
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
      
      // Save contract to database
      const newContract = new Contract({
        contract_address: contractAddress,
        code_id: codeId,
        label: contractDetails.label,
        admin: contractDetails.admin,
        init_msg: initMsg,
        created_at: new Date(contractDetails.created?.at || Date.now()),
        latest_migration_code_id: latestMigrationCodeId
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
   * Update indexer state with current timestamp
   */
  private async updateIndexerState(): Promise<void> {
    // We're using a specific document ID for CosmWasm indexer state
    const cosmwasmIndexerStateId = 'cosmwasm_indexer_state';
    
    // Update or create indexer state
    await IndexerState.updateOne(
      { _id: cosmwasmIndexerStateId },
      { 
        _id: cosmwasmIndexerStateId, // Explicitly include _id in the update/insert
        lastProcessedBlock: 0, // Not using block height for CosmWasm indexer
        updatedAt: new Date() 
      },
      { upsert: true }
    );
  }
}
