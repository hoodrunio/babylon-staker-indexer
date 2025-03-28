import { Request, Response } from 'express';
import { Verification, Code } from '../../../database/models/cosmwasm';
import { logger } from '../../../utils/logger';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import os from 'os';

const execPromise = promisify(exec);

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
   * Submit contract source code for verification
   */
  public async verifyContract(req: Request, res: Response): Promise<void> {
    try {
      const { code_id } = req.body;
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
        uploaded_by: req.body.uploaded_by || null,
        source_path: file.path,
      });
      
      await verification.save();
      
      // Start verification process in the background
      this.processVerification(verification.id, code);
      
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
        .sort({ uploaded_at: -1 });
      
      res.status(200).json({ verifications });
    } catch (error) {
      logger.error(`Error fetching verifications for code ${req.params.code_id}:`, error);
      res.status(500).json({ error: 'Failed to fetch verification records' });
    }
  }

  /**
   * Process the verification in the background
   */
  private async processVerification(verificationId: string, code: any): Promise<void> {
    try {
      const verification = await Verification.findOne({ id: verificationId });
      
      if (!verification) {
        logger.error(`Verification ${verificationId} not found`);
        return;
      }
      
      const sourcePath = verification.source_path;
      const extractPath = path.join(path.dirname(sourcePath), 'extracted');
      
      // Create extraction directory
      fs.mkdirSync(extractPath, { recursive: true });
      
      // Extract the zip file
      await execPromise(`unzip -q "${sourcePath}" -d "${extractPath}"`);
      
      // Build the contract using the rust-optimizer Docker container
      try {
        await execPromise(
          `docker run --rm -v "${extractPath}:/code" --platform linux/amd64 cosmwasm/rust-optimizer:0.12.11`,
          { timeout: 300000 } // 5 minute timeout
        );
        
        // Read the compiled wasm file
        const wasmPath = path.join(extractPath, 'artifacts', 'checksums.txt');
        const checksumContent = fs.readFileSync(wasmPath, 'utf8');
        
        // Extract the hash from checksums.txt (example format: "83dfd4e031f665872e92174686c18890b00b84869030fb2c3cdbd8e1341dd0b1  cw20_base.wasm")
        const hash = checksumContent.split(/\s+/)[0].trim();
        
        // Compare with the on-chain hash
        if (hash.toLowerCase() === code.data_hash.toLowerCase()) {
          // Update verification status to success
          verification.status = 'success';
          verification.wasm_hash = hash;
          await verification.save();
          
          // Update the code record to mark it as verified
          code.verified = true;
          code.source_hash = hash;
          await code.save();
          
          logger.info(`Verification ${verificationId} for code ${code.code_id} succeeded`);
        } else {
          // Update verification status to failed due to hash mismatch
          verification.status = 'failed';
          verification.error = `Hash mismatch. Expected: ${code.data_hash}, Got: ${hash}`;
          verification.wasm_hash = hash;
          await verification.save();
          
          logger.warn(`Verification ${verificationId} failed due to hash mismatch`);
        }
      } catch (error: any) {
        // Update verification status to failed due to build error
        verification.status = 'failed';
        verification.error = `Build error: ${error.message || 'Unknown error'}`;
        await verification.save();
        
        logger.error(`Error building contract for verification ${verificationId}:`, error);
      }
      
      // Clean up the temporary files
      try {
        fs.rmSync(path.dirname(sourcePath), { recursive: true, force: true });
      } catch (cleanupError: any) {
        logger.error(`Error cleaning up verification files for ${verificationId}:`, cleanupError);
      }
    } catch (error: any) {
      logger.error(`Error processing verification ${verificationId}:`, error);
      
      // Update verification record to indicate failure
      try {
        const verification = await Verification.findOne({ id: verificationId });
        if (verification) {
          verification.status = 'failed';
          verification.error = `Processing error: ${error.message || 'Unknown error'}`;
          await verification.save();
        }
      } catch (updateError) {
        logger.error(`Failed to update verification status for ${verificationId}:`, updateError);
      }
    }
  }
}
