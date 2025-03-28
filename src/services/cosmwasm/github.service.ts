import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { logger } from '../../utils/logger';

const execPromise = promisify(exec);

/**
 * Service for handling GitHub repo cloning for CosmWasm verification
 */
export class GitHubService {
  /**
   * Clone a GitHub repository to a temporary directory
   * @param repoUrl The GitHub repository URL
   * @param branch The branch to checkout
   * @param subdir Optional subdirectory within the repo to focus on
   * @returns Path to the cloned repository
   */
  public static async cloneRepository(
    repoUrl: string,
    branch: string,
    subdir?: string
  ): Promise<string> {
    try {
      // Create a unique temporary directory for this clone operation
      const tmpDirBase = path.join(os.tmpdir(), 'cosmwasm-verifier');
      fs.mkdirSync(tmpDirBase, { recursive: true });
      
      const repoDir = path.join(tmpDirBase, uuidv4());
      
      // Clone the repository with specified branch
      logger.info(`Cloning repository ${repoUrl} branch ${branch} to ${repoDir}`);
      await execPromise(`git clone --depth 1 --branch ${branch} ${repoUrl} ${repoDir}`);
      
      // If a subdirectory is specified, make sure it exists
      let workingDir = repoDir;
      if (subdir) {
        workingDir = path.join(repoDir, subdir);
        if (!fs.existsSync(workingDir)) {
          throw new Error(`Subdirectory ${subdir} not found in repository`);
        }
      }
      
      return workingDir;
    } catch (error: any) {
      logger.error('Error cloning GitHub repository:', error);
      throw new Error(`GitHub clone failed: ${error.message}`);
    }
  }
  
  /**
   * Clean up a cloned repository directory
   * @param repoDir Path to the repository directory
   */
  public static async cleanupRepository(repoDir: string): Promise<void> {
    try {
      // Get the base directory (in case we're in a subdirectory)
      const baseDir = repoDir.includes(os.tmpdir()) 
        ? repoDir 
        : path.join(os.tmpdir(), 'cosmwasm-verifier', path.basename(repoDir));
        
      // Remove the entire repository directory
      if (fs.existsSync(baseDir)) {
        logger.info(`Cleaning up repository directory: ${baseDir}`);
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    } catch (error) {
      logger.error('Error cleaning up repository directory:', error);
      // Don't throw an error here as this is just cleanup
    }
  }
  
  /**
   * Schedule cleanup of old repository directories (for use in cron jobs)
   * @param maxAgeHours Maximum age of directories to keep in hours (default: 24)
   */
  public static async cleanupOldRepositories(maxAgeHours: number = 24): Promise<void> {
    try {
      const tmpDirBase = path.join(os.tmpdir(), 'cosmwasm-verifier');
      
      // Skip if the base directory doesn't exist
      if (!fs.existsSync(tmpDirBase)) {
        return;
      }
      
      const now = Date.now();
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
      
      // Read all directories in the base directory
      const directories = fs.readdirSync(tmpDirBase, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => path.join(tmpDirBase, dirent.name));
      
      // Check each directory's age and remove if older than maxAgeHours
      for (const dir of directories) {
        const stats = fs.statSync(dir);
        const age = now - stats.mtimeMs;
        
        if (age > maxAgeMs) {
          logger.info(`Removing old repository directory: ${dir} (age: ${age / 3600000} hours)`);
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      
      logger.info(`Cleanup complete. Checked ${directories.length} repository directories.`);
    } catch (error) {
      logger.error('Error cleaning up old repository directories:', error);
      // Don't throw an error here as this is just cleanup
    }
  }
}
