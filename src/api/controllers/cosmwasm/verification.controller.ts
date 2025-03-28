import { Request, Response } from 'express';
import { Verification, Code } from '../../../database/models/cosmwasm';
import { logger } from '../../../utils/logger';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import os from 'os';
import { VerifierService } from '../../../services/cosmwasm/verifier.service';

// Set up multer storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create a unique temp directory for this upload
    const uploadDir = path.join(os.tmpdir(), 'cosmwasm-verifier', uuidv4());
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'source.zip');
  }
});

export const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
});

/**
 * Controller for managing CosmWasm contract verification
 */
export class VerificationController {

  /**
   * Submit contract source code for verification via ZIP upload
   */
  public async verifyContract(req: Request, res: Response): Promise<void> {
    try {
      const { code_id, optimizer_type, optimizer_version } = req.body;
      const file = req.file;
      
      if (!file) {
        res.status(400).json({ error: 'No source code file provided' });
        return;
      }
      
      if (!code_id || isNaN(Number(code_id))) {
        res.status(400).json({ error: 'Invalid code ID' });
        return;
      }
      
      // Check if the code exists
      const code = await Code.findOne({ code_id: Number(code_id) });
      
      if (!code) {
        res.status(404).json({ error: 'Code not found' });
        return;
      }
      
      // Check if there's already a successful verification
      if (code.verified) {
        res.status(400).json({ error: 'This code is already verified' });
        return;
      }
      
      // Create a verification record
      const verification = new Verification({
        code_id: Number(code_id),
        status: 'pending',
        source_path: file.path,
      });
      
      await verification.save();
      
      // Start verification process in the background using the new service
      VerifierService.verifyFromZip(
        verification.id, 
        file.path, 
        Number(code_id),
        optimizer_type,
        optimizer_version
      );
      
      res.status(202).json({ 
        message: 'Verification process started',
        verification_id: verification.id
      });
    } catch (error) {
      logger.error(`Error submitting contract for verification:`, error);
      res.status(500).json({ error: 'Failed to process verification request' });
    }
  }

  /**
   * Submit contract source code for verification via GitHub repository
   */
  public async verifyContractFromGitHub(req: Request, res: Response): Promise<void> {
    try {
      const { 
        code_id, 
        repo_url, 
        branch, 
        subdir, 
        optimizer_type, 
        optimizer_version 
      } = req.body;
      
      if (!code_id || isNaN(Number(code_id))) {
        res.status(400).json({ error: 'Invalid code ID' });
        return;
      }
      
      if (!repo_url) {
        res.status(400).json({ error: 'Repository URL is required' });
        return;
      }
      
      if (!branch) {
        res.status(400).json({ error: 'Branch name is required' });
        return;
      }
      
      // Validate GitHub URL format
      if (!this.isValidGitHubUrl(repo_url)) {
        res.status(400).json({ error: 'Invalid GitHub repository URL format' });
        return;
      }
      
      // Check if the code exists
      const code = await Code.findOne({ code_id: Number(code_id) });
      
      if (!code) {
        res.status(404).json({ error: 'Code not found' });
        return;
      }
      
      // Check if there's already a successful verification
      if (code.verified) {
        res.status(400).json({ error: 'This code is already verified' });
        return;
      }
      
      // Create a verification record
      const verification = new Verification({
        code_id: Number(code_id),
        status: 'pending',
        repo_url,
        branch
      });
      
      await verification.save();
      
      // Start GitHub verification process in the background
      VerifierService.verifyFromGitHub(
        verification.id,
        repo_url,
        branch,
        Number(code_id),
        subdir,
        optimizer_type,
        optimizer_version
      );
      
      res.status(202).json({ 
        message: 'Verification process started',
        verification_id: verification.id
      });
    } catch (error) {
      logger.error(`Error submitting GitHub contract for verification:`, error);
      res.status(500).json({ error: 'Failed to process GitHub verification request' });
    }
  }

  /**
   * Get verification status
   */
  public async getVerificationStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      if (!id) {
        res.status(400).json({ error: 'Invalid verification ID' });
        return;
      }
      
      const verification = await Verification.findOne({ id });
      
      if (!verification) {
        res.status(404).json({ error: 'Verification record not found' });
        return;
      }
      
      res.status(200).json({ verification });
    } catch (error) {
      logger.error(`Error fetching verification status ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to fetch verification status' });
    }
  }

  /**
   * Get all verification records for a code ID
   */
  public async getVerificationsByCodeId(req: Request, res: Response): Promise<void> {
    try {
      const { code_id } = req.params;
      
      if (!code_id || isNaN(Number(code_id))) {
        res.status(400).json({ error: 'Invalid code ID' });
        return;
      }
      
      const verifications = await Verification.find({ code_id: Number(code_id) })
        .sort({ created_at: -1 });
      
      res.status(200).json({ verifications });
    } catch (error) {
      logger.error(`Error fetching verifications for code ${req.params.code_id}:`, error);
      res.status(500).json({ error: 'Failed to fetch verification records' });
    }
  }

  /**
   * Validate GitHub URL format
   */
  private isValidGitHubUrl(url: string): boolean {
    // Simple validation for GitHub URLs
    return /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url);
  }
}
