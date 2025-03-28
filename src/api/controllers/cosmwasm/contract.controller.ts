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
      
      res.status(200).json({ 
        contract,
        code: code ? {
          code_id: code.code_id,
          creator: code.creator,
          verified: code.verified
        } : null
      });
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
      
      if (codes.length === 0) {
        res.status(200).json({
          contracts: [],
          pagination: {
            total: 0,
            limit: Number(limit),
            skip: Number(skip)
          }
        });
        return;
      }
      
      // Get all code_ids from the codes
      const codeIds = codes.map(code => code.code_id);
      
      // Find contracts with those code_ids
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
      logger.error(`Error fetching contracts by creator ${req.params.creator}:`, error);
      res.status(500).json({ error: 'Failed to fetch contracts for this creator' });
    }
  }
}
