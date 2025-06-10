import { Request, Response } from 'express';
import { SourceCode, SourceFile, Code, Contract } from '../../../database/models/cosmwasm';
import { logger } from '../../../utils/logger';

/**
 * Controller for managing CosmWasm source code display
 */
export class SourceCodeController {
  /**
   * Get source code tree for a codeId
   */
  public getCodeSourceCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { codeId } = req.params;
      const { network } = req.query;
      
      if (!codeId || isNaN(Number(codeId))) {
        res.status(400).json({ 
          success: false,
          error: 'Invalid code ID' 
        });
        return;
      }
      
      if (!network || (network !== 'mainnet' && network !== 'testnet')) {
        res.status(400).json({ 
          success: false,
          error: 'Invalid network. Must be "mainnet" or "testnet"' 
        });
        return;
      }
      
      // Check if the code exists and is verified
      const code = await Code.findOne({ code_id: Number(codeId) });
      
      if (!code) {
        res.status(404).json({ 
          success: false,
          error: 'Code not found' 
        });
        return;
      }
      
      if (!code.verified) {
        res.status(404).json({ 
          success: false,
          error: 'Code has not been verified' 
        });
        return;
      }
      
      // Get the source code tree
      const sourceCode = await SourceCode.findOne({ 
        code_id: Number(codeId),
        network: network as string
      });
      
      if (!sourceCode) {
        res.status(404).json({ 
          success: false,
          error: 'Source code not found' 
        });
        return;
      }
      
      // Get verification details if needed in the future
      // const verification = await Verification.findOne({ 
      //   id: sourceCode.verification_id 
      // });
      
      // Return the source code tree
      res.status(200).json({
        success: true,
        source_code: {
          code_id: sourceCode.code_id,
          verification_id: sourceCode.verification_id,
          repository: sourceCode.repository,
          commit_hash: sourceCode.commit_hash,
          root_directory: sourceCode.root_directory,
          verified: sourceCode.verified,
          verification_date: sourceCode.verification_date
        }
      });
    } catch (error) {
      logger.error(`Error getting source code tree for code ID:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve source code' 
      });
    }
  }
  
  /**
   * Get source code tree for a contract address
   */
  public getContractSourceCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { address } = req.params;
      const { network } = req.query;
      
      if (!address) {
        res.status(400).json({ 
          success: false,
          error: 'Invalid contract address' 
        });
        return;
      }
      
      if (!network || (network !== 'mainnet' && network !== 'testnet')) {
        res.status(400).json({ 
          success: false,
          error: 'Invalid network. Must be "mainnet" or "testnet"' 
        });
        return;
      }
      
      // Find the contract
      const contract = await Contract.findOne({ address });
      
      if (!contract) {
        res.status(404).json({ 
          success: false,
          error: 'Contract not found' 
        });
        return;
      }
      
      // Check if the code exists and is verified
      const code = await Code.findOne({ code_id: contract.code_id });
      
      if (!code) {
        res.status(404).json({ 
          success: false,
          error: 'Code not found' 
        });
        return;
      }
      
      if (!code.verified) {
        res.status(404).json({ 
          success: false,
          error: 'Code has not been verified' 
        });
        return;
      }
      
      // Get the source code tree
      const sourceCode = await SourceCode.findOne({ 
        code_id: code.code_id,
        network: network as string
      });
      
      if (!sourceCode) {
        res.status(404).json({ 
          success: false,
          error: 'Source code not found' 
        });
        return;
      }
      
      // Return the source code tree with contract address included
      res.status(200).json({
        success: true,
        source_code: {
          code_id: sourceCode.code_id,
          contract_address: address,
          verification_id: sourceCode.verification_id,
          repository: sourceCode.repository,
          commit_hash: sourceCode.commit_hash,
          root_directory: sourceCode.root_directory,
          verified: sourceCode.verified,
          verification_date: sourceCode.verification_date
        }
      });
    } catch (error) {
      logger.error(`Error getting source code tree for contract address:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve source code' 
      });
    }
  }
  
  /**
   * Get file content for a specific file path
   */
  public getFileContent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { codeId } = req.params;
      const { network, path: filePath } = req.query;
      
      if (!codeId || isNaN(Number(codeId))) {
        res.status(400).json({ 
          success: false,
          error: 'Invalid code ID' 
        });
        return;
      }
      
      if (!network || (network !== 'mainnet' && network !== 'testnet')) {
        res.status(400).json({ 
          success: false,
          error: 'Invalid network. Must be "mainnet" or "testnet"' 
        });
        return;
      }
      
      if (!filePath) {
        res.status(400).json({ 
          success: false,
          error: 'File path is required' 
        });
        return;
      }
      
      // Get the file content
      const sourceFile = await SourceFile.findOne({ 
        code_id: Number(codeId),
        path: filePath as string,
        network: network as string
      });
      
      if (!sourceFile) {
        res.status(404).json({ 
          success: false,
          error: 'File not found' 
        });
        return;
      }
      
      // Return the file content
      res.status(200).json({
        success: true,
        file: {
          name: sourceFile.path.split('/').pop(),
          path: sourceFile.path,
          content: sourceFile.content,
          type: 'file',
          size: sourceFile.size,
          last_modified: sourceFile.last_modified
        }
      });
    } catch (error) {
      logger.error(`Error getting file content:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve file content' 
      });
    }
  }
} 