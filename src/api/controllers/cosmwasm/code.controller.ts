import { Request, Response } from 'express';
import { Code } from '../../../database/models/cosmwasm';
import { logger } from '../../../utils/logger';

/**
 * Controller for managing CosmWasm code-related endpoints
 */
export class CodeController {

  /**
   * Get all indexed codes
   */
  public async getCodes(req: Request, res: Response): Promise<void> {
    try {
      const { verified, creator, limit = 20, page = 1, skip = 0 } = req.query;
      
      // Build query based on filters
      const query: any = {};
      
      if (verified !== undefined) {
        query.verified = verified === 'true';
      }
      
      if (creator) {
        query.creator = creator;
      }
      
      // Calculate skip value from page if provided
      const skipValue = page && Number(page) > 0 ? (Number(page) - 1) * Number(limit) : Number(skip);
      
      // Execute query with pagination
      const codes = await Code.find(query)
        .sort({ code_id: 1 })
        .skip(skipValue)
        .limit(Number(limit));
      
      const totalCount = await Code.countDocuments(query);
      const totalPages = Math.ceil(totalCount / Number(limit));
      
      res.status(200).json({
        codes,
        pagination: {
          total: totalCount,
          total_pages: totalPages,
          current_page: page ? Number(page) : Math.floor(skipValue / Number(limit)) + 1,
          limit: Number(limit),
          skip: skipValue
        }
      });
    } catch (error) {
      logger.error('Error fetching CosmWasm codes:', error);
      res.status(500).json({ error: 'Failed to fetch codes' });
    }
  }

  /**
   * Get a specific code by its ID
   */
  public async getCodeById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      if (!id || isNaN(Number(id))) {
        res.status(400).json({ error: 'Invalid code ID' });
        return;
      }
      
      const code = await Code.findOne({ code_id: Number(id) });
      
      if (!code) {
        res.status(404).json({ error: 'Code not found' });
        return;
      }
      
      res.status(200).json({ code });
    } catch (error) {
      logger.error(`Error fetching CosmWasm code ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to fetch code details' });
    }
  }

  /**
   * Get contracts instantiated from a specific code ID
   */
  public async getContractsByCodeId(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { limit = 20, page = 1, skip = 0 } = req.query;
      
      if (!id || isNaN(Number(id))) {
        res.status(400).json({ error: 'Invalid code ID' });
        return;
      }
      
      // First check if code exists
      const codeExists = await Code.exists({ code_id: Number(id) });
      
      if (!codeExists) {
        res.status(404).json({ error: 'Code not found' });
        return;
      }
      
      // Calculate skip value from page if provided
      const skipValue = page && Number(page) > 0 ? (Number(page) - 1) * Number(limit) : Number(skip);
      
      // Import within the function to avoid circular dependencies
      const { Contract } = await import('../../../database/models/cosmwasm');
      
      const contracts = await Contract.find({ code_id: Number(id) })
        .sort({ created_at: -1 })
        .skip(skipValue)
        .limit(Number(limit));
      
      const totalCount = await Contract.countDocuments({ code_id: Number(id) });
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
      logger.error(`Error fetching contracts for code ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to fetch contracts for this code' });
    }
  }
}
