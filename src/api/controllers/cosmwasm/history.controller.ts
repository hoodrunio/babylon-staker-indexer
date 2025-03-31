import { Request, Response } from 'express';
import { cosmWasmStateService, FrontendPaginationOptions } from '../../../services/cosmwasm/state.service';
import { logger } from '../../../utils/logger';

/**
 * Controller for managing CosmWasm history and state-related endpoints
 */
export class HistoryController {
  /**
   * Get the current state of the CosmWasm indexer
   */
  public async getState(req: Request, res: Response): Promise<void> {
    try {
      const { network = 'mainnet' } = req.query;
      const state = await cosmWasmStateService.getState(network as string);
      
      res.status(200).json({ state });
    } catch (error) {
      logger.error('Error fetching CosmWasm state:', error);
      res.status(500).json({ error: 'Failed to fetch CosmWasm state' });
    }
  }

  /**
   * Get contract state directly from the chain
   */
  public async getContractState(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      if (!address) {
        res.status(400).json({ error: 'Invalid contract address' });
        return;
      }
      
      // Create pagination options object
      const paginationOptions: FrontendPaginationOptions = {
        limit: Number(limit),
        page: Number(page)
      };
      
      try {
        const stateResponse = await cosmWasmStateService.getContractState(
          address,
          paginationOptions
        );
        
        res.status(200).json(stateResponse);
      } catch (error: any) {
        // Handle the specific error for invalid page or expired cache
        if (error.message && error.message.includes('Invalid page requested')) {
          res.status(400).json({ 
            error: error.message,
            details: 'Cache for this page may have expired. Please restart from page 1.'
          });
        } else {
          throw error; // Re-throw the error to be caught by the outer catch block
        }
      }
    } catch (error) {
      logger.error(`Error fetching state for contract ${req.params.address}:`, error);
      res.status(500).json({ error: 'Failed to fetch contract state' });
    }
  }

  /**
   * Get contract history directly from the chain
   */
  public async getContractHistory(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      if (!address) {
        res.status(400).json({ error: 'Invalid contract address' });
        return;
      }
      
      // Create pagination options object
      const paginationOptions: FrontendPaginationOptions = {
        limit: Number(limit),
        page: Number(page)
      };
      
      try {
        const historyResponse = await cosmWasmStateService.getContractHistory(
          address,
          paginationOptions
        );
        
        res.status(200).json(historyResponse);
      } catch (error: any) {
        // Handle the specific error for invalid page or expired cache
        if (error.message && error.message.includes('Invalid page requested')) {
          res.status(400).json({ 
            error: error.message,
            details: 'Cache for this page may have expired. Please restart from page 1.'
          });
        } else {
          throw error; // Re-throw the error to be caught by the outer catch block
        }
      }
    } catch (error) {
      logger.error(`Error fetching history for contract ${req.params.address}:`, error);
      res.status(500).json({ error: 'Failed to fetch contract history' });
    }
  }

  /**
   * Get transaction history for a specific contract
   */
  public async getContractTransactions(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      if (!address) {
        res.status(400).json({ error: 'Invalid contract address' });
        return;
      }
      
      // Convert page to skip for database pagination
      const skip = (Number(page) - 1) * Number(limit);
      
      const transactions = await cosmWasmStateService.getContractTransactions(
        address,
        Number(limit),
        skip
      );
      
      // Update pagination info to match frontend expectations
      const response = {
        ...transactions,
        pagination: {
          ...transactions.pagination,
          page: Number(page),
          has_next: transactions.pagination.skip + transactions.pagination.limit < transactions.pagination.total
        }
      };
      
      res.status(200).json(response);
    } catch (error) {
      logger.error(`Error fetching transactions for contract ${req.params.address}:`, error);
      res.status(500).json({ error: 'Failed to fetch contract transactions' });
    }
  }

  /**
   * Get transaction history for all contracts associated with a specific code ID
   */
  public async getCodeTransactions(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      if (!id || isNaN(Number(id))) {
        res.status(400).json({ error: 'Invalid code ID' });
        return;
      }
      
      // Convert page to skip for database pagination
      const skip = (Number(page) - 1) * Number(limit);
      
      const transactions = await cosmWasmStateService.getCodeTransactions(
        Number(id),
        Number(limit),
        skip
      );
      
      // Update pagination info to match frontend expectations
      const response = {
        ...transactions,
        pagination: {
          ...transactions.pagination,
          page: Number(page),
          has_next: transactions.pagination.skip + transactions.pagination.limit < transactions.pagination.total
        }
      };
      
      res.status(200).json(response);
    } catch (error) {
      logger.error(`Error fetching transactions for code ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to fetch code transactions' });
    }
  }
}
