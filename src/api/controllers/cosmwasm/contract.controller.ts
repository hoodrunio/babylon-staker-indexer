import { Request, Response } from 'express';
import { Contract } from '../../../database/models/cosmwasm';
import { logger } from '../../../utils/logger';
import path from 'path';
import fs from 'fs';

/**
 * Controller for managing CosmWasm contract-related endpoints
 */
export class ContractController {

  /**
   * Get all indexed contracts with optional filtering
   */
  public async getContracts(req: Request, res: Response): Promise<void> {
    try {
      const { code_id, admin, limit = 20, page = 1, skip = 0, search } = req.query;
      
      // Build query based on filters
      const query: any = {};
      
      if (code_id !== undefined && !isNaN(Number(code_id))) {
        query.code_id = Number(code_id);
      }
      
      if (admin) {
        query.admin = admin;
      }
      
      // Add search parameter - exact match for contract address
      if (search) {
        // If search looks like a number, try searching by code ID
        if (/^\d+$/.test(search as string)) {
          query.code_id = Number(search);
        } else {
          // Otherwise search by contract address
          query.contract_address = search;
        }
      }
      
      // Calculate skip value from page if provided
      const skipValue = page && Number(page) > 0 ? (Number(page) - 1) * Number(limit) : Number(skip);
      
      // Execute query with pagination
      const contracts = await Contract.find(query)
        .sort({ code_id: 1 })
        .skip(skipValue)
        .limit(Number(limit));
      
      const totalCount = await Contract.countDocuments(query);
      const totalPages = Math.ceil(totalCount / Number(limit));
      
      res.status(200).json({
        contracts,
        pagination: {
          total: totalCount,
          total_pages: totalPages,
          current_page: page ? Number(page) : Math.floor(skipValue / Number(limit)) + 1,
          limit: Number(limit),
          skip: skipValue
        }
      });
    } catch (error) {
      logger.error('Error fetching CosmWasm contracts:', error);
      res.status(500).json({ error: 'Failed to fetch contracts' });
    }
  }

  /**
   * Get a specific contract by its address
   */
  public async getContractByAddress(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      
      if (!address) {
        res.status(400).json({ error: 'Invalid contract address' });
        return;
      }
      
      const contract = await Contract.findOne({ contract_address: address });
      
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      
      // Get the related code information
      const { Code } = await import('../../../database/models/cosmwasm');
      const code = await Code.findOne({ code_id: contract.code_id });
      
      // Prepare response with contract methods data
      const response = {
        contract: {
          ...contract.toObject(),
          query_methods: contract.query_methods || [],
          execute_methods: contract.execute_methods || [],
          latest_migration_code_id: contract.latest_migration_code_id || null
        },
        code: code ? {
          code_id: code.code_id,
          creator: code.creator,
          verified: code.verified,
          contract_count: code.contract_count || 0,
          source_type: code.source_type || null,
          optimizer_type: code.optimizer_type || null,
          optimizer_version: code.optimizer_version || null
        } : null
      };
      
      res.status(200).json(response);
    } catch (error) {
      logger.error(`Error fetching CosmWasm contract ${req.params.address}:`, error);
      res.status(500).json({ error: 'Failed to fetch contract details' });
    }
  }

  /**
   * Get contracts created by a specific address
   */
  public async getContractsByCreator(req: Request, res: Response): Promise<void> {
    try {
      const { creator } = req.params;
      const { limit = 20, page = 1, skip = 0 } = req.query;
      
      if (!creator) {
        res.status(400).json({ error: 'Invalid creator address' });
        return;
      }
      
      // Calculate skip value from page if provided
      const skipValue = page && Number(page) > 0 ? (Number(page) - 1) * Number(limit) : Number(skip);
      
      // First we need to find all codes created by this address
      const { Code } = await import('../../../database/models/cosmwasm');
      const codes = await Code.find({ creator });
      
      if (!codes.length) {
        res.status(200).json({ 
          contracts: [], 
          pagination: { 
            total: 0, 
            total_pages: 0,
            current_page: 1,
            limit: Number(limit), 
            skip: skipValue 
          } 
        });
        return;
      }
      
      // Get the code IDs
      const codeIds = codes.map(code => code.code_id);
      
      // Now find all contracts with those code IDs
      const contracts = await Contract.find({ code_id: { $in: codeIds } })
        .sort({ code_id: 1 })
        .skip(skipValue)
        .limit(Number(limit));
        
      const totalCount = await Contract.countDocuments({ code_id: { $in: codeIds } });
      const totalPages = Math.ceil(totalCount / Number(limit));
      
      res.status(200).json({
        contracts,
        pagination: {
          total: totalCount,
          total_pages: totalPages,
          current_page: page ? Number(page) : Math.floor(skipValue / Number(limit)) + 1,
          limit: Number(limit),
          skip: skipValue
        }
      });
    } catch (error) {
      logger.error(`Error fetching contracts for creator ${req.params.creator}:`, error);
      res.status(500).json({ error: 'Failed to fetch creator contracts' });
    }
  }

  /**
   * Get contract methods (query and execute methods)
   */
  public async getContractMethods(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      
      if (!address) {
        res.status(400).json({ error: 'Invalid contract address' });
        return;
      }
      
      const contract = await Contract.findOne({ contract_address: address });
      
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      
      res.status(200).json({
        query_methods: contract.query_methods || [],
        execute_methods: contract.execute_methods || []
      });
    } catch (error) {
      logger.error(`Error fetching methods for contract ${req.params.address}:`, error);
      res.status(500).json({ error: 'Failed to fetch contract methods' });
    }
  }
  
  /**
   * Get suggested query methods for a contract
   * These are automatically extracted from error messages
   */
  public async getSuggestedQueries(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      
      if (!address) {
        res.status(400).json({ error: 'Invalid contract address' });
        return;
      }
      
      const contract = await Contract.findOne({ contract_address: address });
      
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      
      // Get the related code information to check if it's verified
      const { Code } = await import('../../../database/models/cosmwasm');
      const code = await Code.findOne({ code_id: contract.code_id });
      const isVerified = code?.verified || false;
      
      res.status(200).json({
        contract_address: contract.contract_address,
        query_methods: contract.query_methods || [],
        is_verified: isVerified,
        is_inferred: true,
        note: isVerified 
          ? 'These query methods are available from the verified contract schema.'
          : 'These query methods are inferred automatically. Contract is not verified.'
      });
    } catch (error) {
      logger.error(`Error fetching query suggestions for contract ${req.params.address}:`, error);
      res.status(500).json({ error: 'Failed to fetch query suggestions' });
    }
  }

  /**
   * Execute a smart query against a contract
   */
  public async queryContract(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      const queryMsg = req.body;
      
      if (!address) {
        res.status(400).json({ error: 'Invalid contract address' });
        return;
      }
      
      if (!queryMsg || Object.keys(queryMsg).length === 0) {
        res.status(400).json({ error: 'Query message is required' });
        return;
      }
      
      const { BabylonClient } = await import('../../../clients/BabylonClient');
      const client = BabylonClient.getInstance();
      
      try {
        const result = await client.cosmWasmClient.queryContract(address, queryMsg);
        res.status(200).json({
          result: result.data || null,
          success: true
        });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
        // Capture specific known contract query errors
        if (errorMessage.includes('unknown variant')) {
          // Use regex to extract valid query methods if possible
          const methodsMatch = errorMessage.match(/expected one of `(.*?)`/);
          const methods = methodsMatch?.[1]?.split(/`,\s*`/) || [];
          
          res.status(400).json({
            error: 'Invalid query method',
            message: errorMessage,
            suggestions: methods.length > 0 ? { query_methods: methods } : null
          });
        } else {
          res.status(400).json({
            error: 'Contract query failed',
            message: errorMessage
          });
        }
      }
    } catch (error) {
      logger.error(`Error executing smart query for contract ${req.params.address}:`, error);
      res.status(500).json({ error: 'Failed to execute contract query' });
    }
  }

  /**
   * Execute a raw query against a contract's storage
   */
  public async rawQueryContract(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      const { key } = req.query;
      
      if (!address) {
        res.status(400).json({ error: 'Invalid contract address' });
        return;
      }
      
      if (!key || typeof key !== 'string') {
        res.status(400).json({ error: 'Key parameter is required' });
        return;
      }
      
      // Cleaning process - remove spaces and double quotes
      const cleanKey = key.trim().replace(/^"|"$/g, '');
      
      const { BabylonClient } = await import('../../../clients/BabylonClient');
      const client = BabylonClient.getInstance();
      
      try {
        const result = await client.cosmWasmClient.rawQueryContract(address, cleanKey);
        
        // Try to decode the data received as Base64
        let decodedData = null;
        if (result.data && typeof result.data === 'string') {
          try {
            const decoded = Buffer.from(result.data, 'base64').toString('utf-8');
            // Try to parse as JSON
            try {
              decodedData = JSON.parse(decoded);
            } catch {
              // If not JSON, use as plain string
              decodedData = decoded;
            }
          } catch (e) {
            // If it cannot be decoded, use the raw data
            decodedData = result.data;
          }
        }
        
        res.status(200).json({
          result: {
            data: result.data || null,
            decoded: decodedData
          },
          success: true
        });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
        res.status(400).json({
          error: 'Raw contract query failed',
          message: errorMessage
        });
      }
    } catch (error) {
      logger.error(`Error executing raw query for contract ${req.params.address}:`, error);
      res.status(500).json({ error: 'Failed to execute raw contract query' });
    }
  }

  /**
   * Get a list of execute methods for the contract with detailed schema information
   */
  public getExecuteSchemaDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { address } = req.params;
      
      if (!address) {
        res.status(400).json({ error: 'Contract address is required' });
        return;
      }
      
      // Find the contract - use contract_address instead of address
      const contract = await Contract.findOne({ contract_address: address });
      
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      
      // Get the associated code
      const { Code, Verification } = await import('../../../database/models/cosmwasm');
      const code = await Code.findOne({ code_id: contract.code_id });
      
      if (!code) {
        res.status(404).json({ error: 'Associated code not found' });
        return;
      }
      
      // Check if code is verified
      if (!code.verified) {
        res.status(400).json({ 
          error: 'Contract code is not verified, detailed schema information is unavailable',
          execute_methods: contract.execute_methods || []
        });
        return;
      }
      
      // If execute_schema_details exists in the database, return it directly
      if (contract.execute_schema_details && contract.execute_schema_details.length > 0) {
        res.status(200).json({
          contract_address: address,
          code_id: contract.code_id,
          execute_schema: contract.execute_schema_details
        });
        return;
      }
      
      // If it doesn't exist in the database, create and save it
      // Import parser service
      const { SchemaExecuteParserService } = await import('../../../services/cosmwasm/schema-execute-parser.service');
      
      // Get verification to find schema path
      const verification = await Verification.findOne({ 
        code_id: contract.code_id,
        status: 'success'
      });
      
      if (!verification || !verification.source_path) {
        res.status(400).json({ 
          error: 'Verification source path not found',
          execute_methods: contract.execute_methods || []
        });
        return;
      }
      
      // Get schema path
      const schemaPath = path.join(verification.source_path, 'schema');
      
      if (!fs.existsSync(schemaPath)) {
        res.status(400).json({ 
          error: 'Schema directory not found',
          execute_methods: contract.execute_methods || []
        });
        return;
      }
      
      // Parse execute schema
      const executeSchema = SchemaExecuteParserService.parseExecuteSchema(schemaPath);
      
      // Cache in database for future requests
      if (executeSchema && executeSchema.length > 0) {
        contract.execute_schema_details = executeSchema;
        await contract.save();
      }
      
      res.status(200).json({
        contract_address: address,
        code_id: contract.code_id,
        execute_schema: executeSchema
      });
    } catch (error) {
      logger.error(`Error getting execute schema details:`, error);
      res.status(500).json({ error: 'Failed to retrieve execute schema details' });
    }
  };
}
