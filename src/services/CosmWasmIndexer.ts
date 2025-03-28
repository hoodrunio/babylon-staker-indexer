import { CosmWasmClient } from '../clients/CosmWasmClient';
import { Code, Contract } from '../database/models/cosmwasm';
import { logger } from '../utils/logger';
import { IndexerState } from '../database/models/IndexerState';
import { BabylonClient } from '../clients/BabylonClient';

/**
 * Service for indexing CosmWasm data from the blockchain
 */
export class CosmWasmIndexer {
  private readonly client: CosmWasmClient;

  /**
   * Initialize CosmWasm indexer
   */
  constructor() {
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
   * Index all CosmWasm codes and contracts
   */
  public async indexAllCosmWasmData(): Promise<void> {
    try {
      logger.info('Starting CosmWasm data indexing process');
      
      // Get all codes from the chain
      const codesResponse = await this.client.getCodes();
      const chainCodes = codesResponse?.code_infos || [];
      
      logger.info(`Found ${chainCodes.length} CosmWasm codes on chain`);
      
      // Process each code
      for (const codeInfo of chainCodes) {
        const codeId = parseInt(codeInfo.code_id);
        
        // Check if we already have this code in our database
        const existingCode = await Code.findOne({ code_id: codeId });
        
        if (!existingCode) {
          // Get detailed code info
          const codeDetailsResponse = await this.client.getCodeById(codeId);
          const codeDetails = codeDetailsResponse?.code_info;
          
          if (codeDetails) {
            // Save code to database
            const newCode = new Code({
              code_id: codeId,
              creator: codeDetails.creator,
              data_hash: codeDetails.data_hash,
              creation_time: new Date(codeDetails.created?.at || Date.now()),
              verified: false
            });
            
            await newCode.save();
            logger.info(`Indexed new CosmWasm code: ${codeId}`);
            
            // Index contracts instantiated from this code
            await this.indexContractsForCode(codeId);
          }
        } else {
          // Code already indexed, check for new contracts
          await this.indexContractsForCode(codeId);
        }
      }
      
      // Update indexer state
      await this.updateIndexerState();
      
      logger.info('Completed CosmWasm data indexing');
    } catch (error) {
      logger.error('Error indexing CosmWasm data:', error);
      throw error;
    }
  }

  /**
   * Index all contracts instantiated from a specific code
   */
  private async indexContractsForCode(codeId: number): Promise<void> {
    try {
      // Get contracts for this code
      const contractsResponse = await this.client.getContractsByCodeId(codeId);
      const chainContracts = contractsResponse?.contracts || [];
      
      logger.info(`Found ${chainContracts.length} contracts for code ${codeId}`);
      
      // Process each contract
      for (const contractAddress of chainContracts) {
        // Skip if we already have this contract in our database
        const existingContract = await Contract.findOne({ contract_address: contractAddress });
        
        if (!existingContract) {
          // Get contract details
          const contractDetailsResponse = await this.client.getContractByAddress(contractAddress);
          const contractDetails = contractDetailsResponse?.contract_info;
          
          if (contractDetails) {
            // Get contract history to find init message
            const historyResponse = await this.client.getContractHistory(contractAddress);
            const historyEntries = historyResponse?.entries || [];
            
            // Find the instantiate entry to get the init message
            const instantiateEntry = historyEntries.find(
              (entry: { operation: string; msg: string }) => entry.operation === 'CONTRACT_INSTANTIATE'
            );
            
            let initMsg = {};
            
            if (instantiateEntry?.msg) {
              try {
                // Try to parse the init message if it's base64 encoded
                const msgStr = Buffer.from(instantiateEntry.msg, 'base64').toString();
                initMsg = JSON.parse(msgStr);
              } catch (error) {
                logger.warn(`Could not parse init message for contract ${contractAddress}:`, error);
                // Use the raw msg if parsing fails
                initMsg = instantiateEntry.msg;
              }
            }
            
            // Save contract to database
            const newContract = new Contract({
              contract_address: contractAddress,
              code_id: codeId,
              label: contractDetails.label,
              admin: contractDetails.admin,
              init_msg: initMsg,
              created_at: new Date(contractDetails.created?.at || Date.now())
            });
            
            await newContract.save();
            logger.info(`Indexed new CosmWasm contract: ${contractAddress}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Error indexing contracts for code ${codeId}:`, error);
      throw error;
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
        lastProcessedBlock: 0, // Not using block height for CosmWasm indexer
        updatedAt: new Date() 
      },
      { upsert: true }
    );
  }
}
