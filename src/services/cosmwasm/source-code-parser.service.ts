import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';
import { SourceCode, SourceFile } from '../../database/models/cosmwasm';

/**
 * Service for parsing source code directories and storing them in the database
 */
export class SourceCodeParserService {
  /**
   * Parse a source code directory and store it in the database
   * @param codeId The code ID
   * @param verificationId The verification record ID
   * @param projectPath Path to the source code project
   * @param repositoryUrl Optional repository URL (for GitHub verifications)
   * @param commitHash Optional commit hash (for GitHub verifications)
   * @param network The network (mainnet or testnet)
   * @returns The created SourceCode record
   */
  public static async parseAndStoreSourceCode(
    codeId: number,
    verificationId: string,
    projectPath: string,
    repositoryUrl: string | null = null,
    commitHash: string | null = null,
    network: string
  ): Promise<any> {
    try {
      logger.info(`Parsing and storing source code for code ID ${codeId}`);

      // Delete any existing source code records for this codeId and network
      await SourceCode.deleteMany({ code_id: codeId, network });
      await SourceFile.deleteMany({ code_id: codeId, network });

      // Parse the directory structure
      const rootDirectory = this.parseDirectory(projectPath, '');

      // Create a new SourceCode record
      const sourceCode = new SourceCode({
        code_id: codeId,
        verification_id: verificationId,
        repository: repositoryUrl,
        commit_hash: commitHash,
        root_directory: rootDirectory,
        verified: true,
        verification_date: new Date(),
        network
      });

      // Save the SourceCode record
      await sourceCode.save();

      // Store file contents separately in SourceFile collection
      await this.storeFileContents(codeId, projectPath, network);

      logger.info(`Successfully stored source code for code ID ${codeId}`);
      return sourceCode;
    } catch (error) {
      logger.error(`Error parsing and storing source code for code ID ${codeId}:`, error);
      throw error;
    }
  }

  /**
   * Recursively parse a directory structure
   * @param basePath Base path of the project
   * @param relativePath Current relative path within the project
   * @returns Directory node structure
   */
  private static parseDirectory(basePath: string, relativePath: string): any {
    const fullPath = path.join(basePath, relativePath);
    const name = path.basename(relativePath) || 'root';
    const directoryPath = relativePath || '/';

    // Parse directory contents
    const contents = fs.readdirSync(fullPath);
    const children = [];

    for (const item of contents) {
      const itemRelativePath = path.join(relativePath, item);
      const itemFullPath = path.join(basePath, itemRelativePath);
      const stats = fs.statSync(itemFullPath);

      // Skip node_modules, target, and hidden directories
      if (item === 'node_modules' || item === 'target' || item.startsWith('.')) {
        continue;
      }

      if (stats.isDirectory()) {
        // Recursively process subdirectories
        const subDirectory = this.parseDirectory(basePath, itemRelativePath);
        children.push(subDirectory);
      } else {
        // Add file info (but not content)
        children.push({
          name: item,
          path: '/' + itemRelativePath.replace(/\\/g, '/'),
          type: 'file',
          size: stats.size,
          last_modified: stats.mtime
        });
      }
    }

    return {
      name,
      path: '/' + directoryPath.replace(/\\/g, '/'),
      type: 'directory',
      children
    };
  }

  /**
   * Store file contents separately in SourceFile collection
   * @param codeId The code ID
   * @param basePath Base path of the project
   * @param network The network (mainnet or testnet)
   */
  private static async storeFileContents(codeId: number, basePath: string, network: string): Promise<void> {
    try {
      // Use a queue to avoid stack overflow for deep directory structures
      const queue: { relativePath: string }[] = [{ relativePath: '' }];
      const filePromises: Promise<any>[] = [];

      while (queue.length > 0) {
        const { relativePath } = queue.shift()!;
        const fullPath = path.join(basePath, relativePath);
        
        const contents = fs.readdirSync(fullPath);
        
        for (const item of contents) {
          const itemRelativePath = path.join(relativePath, item);
          const itemFullPath = path.join(basePath, itemRelativePath);
          const stats = fs.statSync(itemFullPath);

          // Skip node_modules, target, and hidden directories
          if (item === 'node_modules' || item === 'target' || item.startsWith('.')) {
            continue;
          }

          if (stats.isDirectory()) {
            // Add directory to queue
            queue.push({ relativePath: itemRelativePath });
          } else {
            // Skip very large files (>1MB)
            if (stats.size > 1024 * 1024) {
              logger.warn(`Skipping large file (${stats.size} bytes): ${itemRelativePath}`);
              continue;
            }

            // Read file content and store in database
            const normalizedPath = '/' + itemRelativePath.replace(/\\/g, '/');
            
            try {
              const content = fs.readFileSync(itemFullPath, 'utf8');
              
              const sourceFile = new SourceFile({
                code_id: codeId,
                path: normalizedPath,
                content,
                size: stats.size,
                last_modified: stats.mtime,
                network
              });
              
              filePromises.push(sourceFile.save());
            } catch (err) {
              // Skip files that can't be read as text
              logger.warn(`Skipping non-text file: ${itemRelativePath}`);
            }
          }
        }
      }

      // Wait for all file saves to complete
      await Promise.all(filePromises);
      logger.info(`Stored ${filePromises.length} source files for code ID ${codeId}`);
    } catch (error) {
      logger.error(`Error storing file contents for code ID ${codeId}:`, error);
      throw error;
    }
  }
} 