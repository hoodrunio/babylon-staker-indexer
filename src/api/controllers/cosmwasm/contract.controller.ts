import { Request, Response } from 'express';
import { Contract } from '../../../database/models/cosmwasm';
import { logger } from '../../../utils/logger';

/**
 * Controller for managing CosmWasm contract-related endpoints
 */
export class ContractController {

  /**
   * Get all indexed contracts with optional filtering
   */
  public async getContracts(req: Request, res: Response): Promise<void> {
    try {
      const { code_id, admin, limit = 20, skip = 0 } = req.query;
      
      // Build query based on filters
      const query: any = {};
      
      if (code_id !== undefined && !isNaN(Number(code_id))) {
        query.code_id = Number(code_id);
      }
      
      if (admin) {
        query.admin = admin;
      }
      
      // Execute query with pagination
      const contracts = await Contract.find(query)
        .sort({ created_at: -1 })
        .skip(Number(skip))
        .limit(Number(limit));
      
      const totalCount = await Contract.countDocuments(query);
      
      res.status(200).json({
        contracts,
        pagination: {
          total: totalCount,
          limit: Number(limit),
          skip: Number(skip)
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
      const { limit = 20, skip = 0 } = req.query;
      
      if (!creator) {
        res.status(400).json({ error: 'Invalid creator address' });
        return;
      }
      
      // First we need to find all codes created by this address
      const { Code } = await import('../../../database/models/cosmwasm');
      const codes = await Code.find({ creator });
      
      if (!codes.length) {
        res.status(200).json({ 
          contracts: [], 
          pagination: { total: 0, limit: Number(limit), skip: Number(skip) } 
        });
        return;
      }
      
      // Get the code IDs
      const codeIds = codes.map(code => code.code_id);
      
      // Now find all contracts with those code IDs
      const contracts = await Contract.find({ code_id: { $in: codeIds } })
        .sort({ created_at: -1 })
        .skip(Number(skip))
        .limit(Number(limit));
        
      const totalCount = await Contract.countDocuments({ code_id: { $in: codeIds } });
      
      res.status(200).json({
        contracts,
        pagination: {
          total: totalCount,
          limit: Number(limit),
          skip: Number(skip)
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
}
