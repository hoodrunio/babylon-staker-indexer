import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { Code, Contract, Verification } from '../../database/models/cosmwasm';
import { SchemaParserService } from './schema-parser.service';
import { GitHubService } from './github.service';

const execPromise = promisify(exec);

/**
 * Types of CosmWasm contract optimizers
 */
export enum OptimizerType {
  RUST_OPTIMIZER = 'rust-optimizer',
  WORKSPACE_OPTIMIZER = 'workspace-optimizer'
}

/**
 * Service for verifying CosmWasm contracts against source code
 */
export class VerifierService {
  /**
   * Verify a contract from a ZIP file
   * @param verificationId The verification record ID
   * @param sourceFilePath Path to the uploaded ZIP file
   * @param codeId The code ID to verify
   * @param optimizerType The type of optimizer to use
   * @param optimizerVersion The version of optimizer to use
   */
  public static async verifyFromZip(
    verificationId: string,
    sourceFilePath: string,
    codeId: number,
    optimizerType: OptimizerType,
    optimizerVersion: string
  ): Promise<void> {
    try {
      logger.info(`Starting verification process for code ID ${codeId} from ZIP`);
      
      // Get the verification record
      const verification = await Verification.findOne({ id: verificationId });
      if (!verification) {
        throw new Error(`Verification record ${verificationId} not found`);
      }
      
      // Get the code record
      const code = await Code.findOne({ code_id: codeId });
      if (!code) {
        throw new Error(`Code ID ${codeId} not found`);
      }
      
      // Create extraction directory
      const extractPath = path.join(path.dirname(sourceFilePath), 'extracted');
      fs.mkdirSync(extractPath, { recursive: true });
      
      // Extract the ZIP file
      await execPromise(`unzip -q "${sourceFilePath}" -d "${extractPath}"`);
      
      // Check for standard Rust project structure
      this.validateProjectStructure(extractPath);
      
      // Build the contract
      const wasmPath = await this.buildContract(extractPath, optimizerType, optimizerVersion);
      
      // Calculate hash of the built WASM file
      const wasmHash = this.calculateWasmHash(wasmPath);
      
      // Update verification record with the hash
      verification.wasm_hash = wasmHash;
      
      // Compare with the chain hash
      if (wasmHash.toLowerCase() === code.checksum.toLowerCase()) {
        // Extract schema information if successful
        const schemaPath = path.join(extractPath, 'schema');
        const queryMethods = SchemaParserService.extractQueryMethods(schemaPath);
        const executeMethods = SchemaParserService.extractExecuteMethods(schemaPath);
        
        // Update verification record
        verification.status = 'success';
        await verification.save();
        
        // Update code record
        code.verified = true;
        code.source_type = 'zip';
        code.source_url = sourceFilePath;
        code.wasm_hash = wasmHash;
        code.optimizer_type = optimizerType;
        code.optimizer_version = optimizerVersion;
        await code.save();
        
        // Find all contracts using this code and update their methods
        const { Contract } = await import('../../database/models/cosmwasm');
        await Contract.updateMany(
          { code_id: codeId },
          { 
            query_methods: queryMethods,
            execute_methods: executeMethods
          }
        );
        
        logger.info(`Verification ${verificationId} for code ${codeId} succeeded`);
        logger.info(`Found ${queryMethods.length} query methods and ${executeMethods.length} execute methods`);
      } else {
        // Update verification record to failed status
        verification.status = 'failed';
        verification.error = `Hash mismatch. Chain hash: ${code.checksum}, Built hash: ${wasmHash}`;
        await verification.save();
        
        logger.warn(`Verification ${verificationId} failed due to hash mismatch`);
      }
      
      // Clean up
      try {
        this.cleanupVerification(extractPath);
      } catch (cleanupError) {
        logger.error(`Error cleaning up verification files for ${verificationId}:`, cleanupError);
      }
    } catch (error: any) {
      logger.error(`Error verifying from ZIP for ${verificationId}:`, error);
      
      // Update verification record
      try {
        const verification = await Verification.findOne({ id: verificationId });
        if (verification) {
          verification.status = 'failed';
          verification.error = `Verification error: ${error.message || 'Unknown error'}`;
          await verification.save();
        }
      } catch (updateError) {
        logger.error(`Failed to update verification status for ${verificationId}:`, updateError);
      }
    }
  }
  
  /**
   * Verify a contract from a GitHub repository
   * @param verificationId The verification record ID
   * @param repoUrl The GitHub repository URL
   * @param branch The branch to checkout
   * @param subdir Optional subdirectory within the repo to focus on
   * @param codeId The code ID to verify
   * @param optimizerType The type of optimizer to use
   * @param optimizerVersion The version of optimizer to use
   */
  public static async verifyFromGitHub(
    verificationId: string,
    repoUrl: string,
    branch: string,
    subdir: string,
    codeId: number,
    optimizerType: OptimizerType,
    optimizerVersion: string
  ): Promise<void> {
    let repoPath = '';
    
    try {
      logger.info(`Starting verification process for code ID ${codeId} from GitHub`);
      
      // Get the verification record
      const verification = await Verification.findOne({ id: verificationId });
      if (!verification) {
        throw new Error(`Verification record ${verificationId} not found`);
      }
      
      // Get the code record
      const code = await Code.findOne({ code_id: codeId });
      if (!code) {
        throw new Error(`Code ID ${codeId} not found`);
      }
      
      // Clone the repository
      repoPath = await GitHubService.cloneRepository(repoUrl, branch, subdir);
      
      // Update the source path in verification record
      verification.source_path = repoPath;
      verification.repo_url = repoUrl;
      verification.branch = branch;
      await verification.save();
      
      // Check for standard Rust project structure
      this.validateProjectStructure(repoPath);
      
      // Build the contract
      const wasmPath = await this.buildContract(repoPath, optimizerType, optimizerVersion);
      
      // Calculate hash of the built WASM file
      const wasmHash = this.calculateWasmHash(wasmPath);
      
      // Update verification record with the hash
      verification.wasm_hash = wasmHash;
      
      // Compare with the chain hash
      if (wasmHash.toLowerCase() === code.checksum.toLowerCase()) {
        // Extract schema information if successful
        const schemaPath = path.join(repoPath, 'schema');
        const queryMethods = SchemaParserService.extractQueryMethods(schemaPath);
        const executeMethods = SchemaParserService.extractExecuteMethods(schemaPath);
        
        // Update verification record
        verification.status = 'success';
        await verification.save();
        
        // Update code record
        code.verified = true;
        code.source_type = 'github';
        code.source_url = repoUrl;
        code.wasm_hash = wasmHash;
        code.optimizer_type = optimizerType;
        code.optimizer_version = optimizerVersion;
        await code.save();
        
        // Find all contracts using this code and update their methods
        const { Contract } = await import('../../database/models/cosmwasm');
        await Contract.updateMany(
          { code_id: codeId },
          { 
            query_methods: queryMethods,
            execute_methods: executeMethods
          }
        );
        
        logger.info(`Verification ${verificationId} for code ${codeId} succeeded`);
        logger.info(`Found ${queryMethods.length} query methods and ${executeMethods.length} execute methods`);
      } else {
        // Update verification record to failed status
        verification.status = 'failed';
        verification.error = `Hash mismatch. Chain hash: ${code.checksum}, Built hash: ${wasmHash}`;
        await verification.save();
        
        logger.warn(`Verification ${verificationId} failed due to hash mismatch`);
      }
    } catch (error: any) {
      logger.error(`Error verifying from GitHub for ${verificationId}:`, error);
      
      // Update verification record
      try {
        const verification = await Verification.findOne({ id: verificationId });
        if (verification) {
          verification.status = 'failed';
          verification.error = `Verification error: ${error.message || 'Unknown error'}`;
          await verification.save();
        }
      } catch (updateError) {
        logger.error(`Failed to update verification status for ${verificationId}:`, updateError);
      }
    } finally {
      // Clean up repository if it was cloned
      if (repoPath) {
        try {
          await GitHubService.cleanupRepository(repoPath);
        } catch (cleanupError) {
          logger.error(`Error cleaning up GitHub repository for ${verificationId}:`, cleanupError);
        }
      }
    }
  }
  
  /**
   * Validate that the project has the necessary Rust structure
   * @param projectPath Path to the project directory
   */
  private static validateProjectStructure(projectPath: string): void {
    const cargoTomlPath = path.join(projectPath, 'Cargo.toml');
    const srcDirPath = path.join(projectPath, 'src');
    
    if (!fs.existsSync(cargoTomlPath)) {
      throw new Error('Cargo.toml not found in project root');
    }
    
    if (!fs.existsSync(srcDirPath) || !fs.statSync(srcDirPath).isDirectory()) {
      throw new Error('src directory not found in project root');
    }
    
    // Check for lib.rs or main.rs in src directory
    const libPath = path.join(srcDirPath, 'lib.rs');
    const mainPath = path.join(srcDirPath, 'main.rs');
    
    if (!fs.existsSync(libPath) && !fs.existsSync(mainPath)) {
      throw new Error('Neither lib.rs nor main.rs found in src directory');
    }
  }
  
  /**
   * Build the contract using the specified optimizer
   * @param projectPath Path to the project directory
   * @param optimizerType Type of optimizer to use
   * @param optimizerVersion Version of optimizer to use
   * @returns Path to the built WASM file
   */
  private static async buildContract(
    projectPath: string,
    optimizerType: OptimizerType,
    optimizerVersion: string
  ): Promise<string> {
    const dockerImage = `cosmwasm/${optimizerType}:${optimizerVersion}`;
    const platform = `--platform linux/amd64`;
    
    logger.info(`Building contract using ${dockerImage}`);
    
    try {
      // Run the optimizer with a timeout of 60 seconds
      await execPromise(
        `docker run ${platform} --rm -v "${projectPath}:/code" ${dockerImage}`,
        { timeout: 60000 }
      );
      
      // Check for artifacts directory
      const artifactsDir = path.join(projectPath, 'artifacts');
      if (!fs.existsSync(artifactsDir)) {
        throw new Error('Build failed: artifacts directory not found');
      }
      
      // Get the WASM file - should be only one but we'll check for checksums.txt
      const checksumPath = path.join(artifactsDir, 'checksums.txt');
      if (fs.existsSync(checksumPath)) {
        return checksumPath;
      }
      
      // If checksums.txt not found, look for any .wasm file
      const wasmFiles = fs.readdirSync(artifactsDir).filter(file => file.endsWith('.wasm'));
      if (wasmFiles.length === 0) {
        throw new Error('Build failed: no WASM files found in artifacts directory');
      }
      
      return path.join(artifactsDir, wasmFiles[0]);
    } catch (error: any) {
      if (error.code === 'ETIMEDOUT') {
        throw new Error('Build timed out after 60 seconds');
      }
      throw new Error(`Build failed: ${error.message || 'Unknown error'}`);
    }
  }
  
  /**
   * Calculate the SHA256 hash of a WASM file
   * @param filePath Path to the file (either WASM or checksums.txt)
   * @returns SHA256 hash of the file
   */
  private static calculateWasmHash(filePath: string): string {
    // If we have a checksums.txt file, parse it to get the hash
    if (filePath.endsWith('checksums.txt')) {
      const content = fs.readFileSync(filePath, 'utf8');
      // Format: "83dfd4e031f665872e92174686c18890b00b84869030fb2c3cdbd8e1341dd0b1  cw20_base.wasm"
      const match = content.match(/^([a-fA-F0-9]+)/);
      if (match && match[1]) {
        return match[1];
      }
      throw new Error('Invalid checksums.txt format');
    }
    
    // Otherwise calculate the hash directly from the WASM file
    const fileContent = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileContent).digest('hex');
  }
  
  /**
   * Clean up verification files
   * @param extractPath Path to the extraction directory
   */
  private static cleanupVerification(extractPath: string): void {
    if (fs.existsSync(extractPath)) {
      fs.rmSync(extractPath, { recursive: true, force: true });
    }
  }

  /**
   * Process verification result
   * @param codeId Code ID that was verified
   * @param success Whether verification was successful
   * @param data Additional data from verification
   */
  private async processVerificationResult(codeId: number, success: boolean, data: any): Promise<void> {
    try {
      // Update code record with verification status
      await Code.updateOne(
        { code_id: codeId },
        { 
          $set: { 
            verified: success,
            source_type: data.source_type || null,
            source_url: data.source_url || null,
            optimizer_type: data.optimizer_type || null,
            optimizer_version: data.optimizer_version || null
          }
        }
      );
      
      // If verification was successful, update contracts with schema information
      if (success && data.query_methods) {
        // Get all contracts for this code
        const contracts = await Contract.find({ code_id: codeId });
        
        logger.info(`Updating ${contracts.length} contracts with schema information for code ${codeId}`);
        
        // Process each contract
        for (const contract of contracts) {
          // Update query methods if they were extracted
          if (data.query_methods.length > 0) {
            contract.query_methods = data.query_methods;
          }
          
          // Update execute methods if they were extracted
          if (data.execute_methods.length > 0) {
            contract.execute_methods = data.execute_methods;
          }
          
          await contract.save();
        }
      }
      
      // Update verification record
      await Verification.updateOne(
        { code_id: codeId },
        { 
          $set: { 
            status: success ? 'SUCCESS' : 'FAILURE',
            details: data
          }
        }
      );
    } catch (error) {
      logger.error(`Error processing verification result for code ${codeId}:`, error);
    }
  }
}
