import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { Code, Contract, Verification } from '../../database/models/cosmwasm';
import { SchemaParserService } from './schema-parser.service';
import { GitHubService } from './github.service';
import { SourceCodeParserService } from './source-code-parser.service';
import { BabylonClient } from '../../clients/BabylonClient';

const execPromise = promisify(exec);

/**
 * Types of CosmWasm contract optimizers
 */
export enum OptimizerType {
  RUST_OPTIMIZER = 'rust-optimizer',
  WORKSPACE_OPTIMIZER = 'workspace-optimizer',
  OPTIMIZER = 'optimizer'
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
        
        // Parse and store source code for frontend display
        try {
          // Get current network from BabylonClient
          const network = BabylonClient.getInstance().getNetwork().toLowerCase();
          
          await SourceCodeParserService.parseAndStoreSourceCode(
            codeId,
            verificationId,
            extractPath,
            null, // No repository URL for ZIP uploads
            null, // No commit hash for ZIP uploads
            network
          );
          
          logger.info(`Source code for code ID ${codeId} has been stored for frontend display (network: ${network})`);
        } catch (sourceCodeError) {
          logger.error(`Error storing source code for code ID ${codeId}:`, sourceCodeError);
          // Continue even if source code storage fails - verification itself succeeded
        }
        
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
    let repoDir = '';
    
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
      const { repoDir: rootDir, workingDir } = await GitHubService.cloneRepository(repoUrl, branch, subdir);
      repoDir = rootDir; // Keep track of root directory for cleanup
      
      // For workspace-optimizer or optimizer with workspace, we always use the root directory
      // For rust-optimizer or optimizer with single contract, we use the working directory (with subdir)
      if (optimizerType === OptimizerType.WORKSPACE_OPTIMIZER || 
         (optimizerType === OptimizerType.OPTIMIZER && this.isWorkspace(rootDir))) {
        repoPath = rootDir;
      } else {
        repoPath = workingDir;
      }
      
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
        
        // Parse and store source code for frontend display
        try {
          // Extract commit hash from the repository
          const { stdout: commitHash } = await execPromise(`cd "${repoPath}" && git rev-parse HEAD`);
          
          // Get current network from BabylonClient
          const network = BabylonClient.getInstance().getNetwork().toLowerCase();
          
          await SourceCodeParserService.parseAndStoreSourceCode(
            codeId,
            verificationId,
            repoPath,
            repoUrl,
            commitHash.trim(), // Trim to remove newlines
            network
          );
          
          logger.info(`Source code for code ID ${codeId} has been stored for frontend display (network: ${network})`);
        } catch (sourceCodeError) {
          logger.error(`Error storing source code for code ID ${codeId}:`, sourceCodeError);
          // Continue even if source code storage fails - verification itself succeeded
        }
        
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
      if (repoDir) {
        try {
          await GitHubService.cleanupRepository(repoDir);
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
    
    if (!fs.existsSync(cargoTomlPath)) {
      throw new Error('Cargo.toml not found in project root');
    }
    
    // Check if this is a workspace
    const cargoContent = fs.readFileSync(cargoTomlPath, 'utf8');
    const isWorkspace = cargoContent.includes('[workspace]');
    
    if (isWorkspace) {
      // For workspace, we need to check if there are directories in contracts/
      const contractsDir = path.join(projectPath, 'contracts');
      if (fs.existsSync(contractsDir) && fs.statSync(contractsDir).isDirectory()) {
        // Workspace seems valid
        return;
      }
    } else {
      // For a standalone contract, check for src directory
      const srcDirPath = path.join(projectPath, 'src');
      
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
    
    // Set appropriate timeouts based on optimizer type
    const timeout = optimizerType === OptimizerType.WORKSPACE_OPTIMIZER || optimizerType === OptimizerType.OPTIMIZER 
      ? 300000 // 5 min for workspace or optimizer
      : 120000; // 2 min for rust-optimizer
    
    // Get project directory name for cache naming
    const projectName = path.basename(projectPath).replace(/[^a-zA-Z0-9]/g, '_');
    
    logger.info(`Building contract using ${dockerImage} with timeout of ${timeout/1000} seconds`);
    logger.info(`Project path: ${projectPath}, using cache name: ${projectName}_cache`);
    
    try {
      // For workspace-optimizer, check if we're dealing with workspace root or contract subdir
      if (optimizerType === OptimizerType.WORKSPACE_OPTIMIZER || optimizerType === OptimizerType.OPTIMIZER) {
        const cargoPath = path.join(projectPath, 'Cargo.toml');
        const cargoContent = fs.readFileSync(cargoPath, 'utf8');
        
        // If this is a subdirectory and not a workspace, we need to adjust
        if (!cargoContent.includes('[workspace]')) {
          // For OPTIMIZER type, if not a workspace, treat it like rust-optimizer (single contract)
          if (optimizerType === OptimizerType.OPTIMIZER) {
            logger.info('Using optimizer for single contract (not workspace)');
          } else {
            // For WORKSPACE_OPTIMIZER, we need to find the workspace root
            // Try to find the workspace root (go up until we find a workspace Cargo.toml)
            let currentPath = projectPath;
            let foundWorkspace = false;
            
            while (path.dirname(currentPath) !== currentPath) { // Stop at filesystem root
              currentPath = path.dirname(currentPath);
              const rootCargoPath = path.join(currentPath, 'Cargo.toml');
              
              if (fs.existsSync(rootCargoPath)) {
                const rootCargoContent = fs.readFileSync(rootCargoPath, 'utf8');
                if (rootCargoContent.includes('[workspace]')) {
                  // Found workspace root, use that instead
                  logger.info(`Found workspace root at ${currentPath}`);
                  projectPath = currentPath;
                  foundWorkspace = true;
                  break;
                }
              }
            }
            
            if (!foundWorkspace) {
              throw new Error('When using workspace-optimizer, a workspace root with [workspace] in Cargo.toml must be found');
            }
          }
        }
      } else if (optimizerType === OptimizerType.RUST_OPTIMIZER || 
                 (optimizerType === OptimizerType.OPTIMIZER && !this.isWorkspace(projectPath))) {
        // For rust-optimizer, make sure the Cargo.toml doesn't reference workspace
        const cargoPath = path.join(projectPath, 'Cargo.toml');
        let cargoContent = fs.readFileSync(cargoPath, 'utf8');
        
        // Check if it references workspace
        if (cargoContent.includes('workspace = true') || 
            cargoContent.includes('.workspace = true') ||
            cargoContent.includes('workspace.package')) {
            
          logger.info('Detected workspace references in Cargo.toml. Temporarily modifying for rust-optimizer...');
          
          // Create backup
          const backupPath = `${cargoPath}.bak`;
          fs.writeFileSync(backupPath, cargoContent);
          
          // Remove workspace references
          cargoContent = cargoContent.replace(/version\.workspace\s*=\s*true/g, 'version = "2.0.0"');
          cargoContent = cargoContent.replace(/authors\.workspace\s*=\s*true/g, 'authors = ["CosmWasm"]');
          cargoContent = cargoContent.replace(/edition\.workspace\s*=\s*true/g, 'edition = "2021"');
          
          // Write modified Cargo.toml
          fs.writeFileSync(cargoPath, cargoContent);
          
          // Remember to restore after build
          try {
            // Run the optimizer
            await execPromise(
              `docker run ${platform} --rm -v "${projectPath}:/code" \
              --mount type=volume,source="${projectName}_cache",target=/target \
              --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
              ${dockerImage}`,
              { timeout }
            );
            
            // Restore original Cargo.toml
            fs.copyFileSync(backupPath, cargoPath);
            fs.unlinkSync(backupPath);
            
            // Check for artifacts directory
            const artifactsDir = path.join(projectPath, 'artifacts');
            if (!fs.existsSync(artifactsDir)) {
              throw new Error('Build failed: artifacts directory not found');
            }
            
            // Get the WASM file
            const checksumPath = path.join(artifactsDir, 'checksums.txt');
            if (fs.existsSync(checksumPath)) {
              return checksumPath;
            }
            
            const wasmFiles = fs.readdirSync(artifactsDir).filter(file => file.endsWith('.wasm'));
            if (wasmFiles.length === 0) {
              throw new Error('Build failed: no WASM files found in artifacts directory');
            }
            
            return path.join(artifactsDir, wasmFiles[0]);
          } catch (error) {
            // Make sure to restore even on error
            if (fs.existsSync(backupPath)) {
              fs.copyFileSync(backupPath, cargoPath);
              fs.unlinkSync(backupPath);
            }
            throw error;
          }
        }
      }
      
      // Run the optimizer
      await execPromise(
        `docker run ${platform} --rm -v "${projectPath}:/code" \
        --mount type=volume,source="${projectName}_cache",target=/target \
        --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
        ${dockerImage}`,
        { timeout }
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
        throw new Error(`Build timed out after ${timeout/1000} seconds. Consider using a larger timeout for complex contracts.`);
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

  /**
   * Check if the directory contains a workspace Cargo.toml
   * @param dirPath Path to check for workspace
   * @returns true if it's a workspace
   */
  private static isWorkspace(dirPath: string): boolean {
    const cargoTomlPath = path.join(dirPath, 'Cargo.toml');
    if (!fs.existsSync(cargoTomlPath)) {
      return false;
    }
    const cargoContent = fs.readFileSync(cargoTomlPath, 'utf8');
    return cargoContent.includes('[workspace]');
  }
}
