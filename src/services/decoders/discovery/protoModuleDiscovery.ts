/**
 * Proto module discovery functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../utils/logger';
import { MessageDecoder } from '../types';

/**
 * Responsible for discovering proto modules and their message types
 */
export class ProtoModuleDiscovery {
  /**
   * Standard namespace paths
   */
  private static readonly STANDARD_NAMESPACES = {
    babylon: {
      modules: [
        'finality/v1', 
        'btcstaking/v1', 
        'epoching/v1', 
        'checkpointing/v1',
        'btclightclient/v1'
      ],
      basePath: '../../../generated/proto'
    },
    cosmwasm: {
      modules: ['wasm/v1'],
      basePath: '../../../generated/proto'
    },
    cosmos: {
      modules: [
        'bank/v1beta1',
        'staking/v1beta1', 
        'distribution/v1beta1',
        'gov/v1beta1',
        'authz/v1beta1',
        'feegrant/v1beta1',
        'evidence/v1beta1',
        'slashing/v1beta1',
        'vesting/v1beta1'
      ],
      basePath: 'cosmjs-types'
    },
    ibc: {
      modules: [
        'core/client/v1',
        'core/channel/v1',
        'core/connection/v1',
        'applications/transfer/v1'
      ],
      basePath: '../../../generated/proto'
    }
  };
  
  private decoderRegistry: Map<string, MessageDecoder>;
  
  constructor(decoderRegistry: Map<string, MessageDecoder>) {
    this.decoderRegistry = decoderRegistry;
  }
  
  /**
   * Discover and register all proto modules
   */
  public discoverAllModules(): void {
    logger.info('[Message Decoder] Discovering proto modules...');
    
    try {
      // Register standard namespaces
      this.registerStandardNamespaces();
      
      // Auto-discover other modules
      this.discoverGeneratedProtos();
      
      logger.info(`[Message Decoder] Registered ${this.decoderRegistry.size} message types.`);
    } catch (error) {
      // Continue with whatever modules were successfully loaded
      logger.warn(`[Message Decoder] Some proto modules failed to load but continuing with ${this.decoderRegistry.size} registered types.`, error);
    }
  }
  
  /**
   * Register all standard namespaces
   */
  private registerStandardNamespaces(): void {
    for (const [namespace, config] of Object.entries(ProtoModuleDiscovery.STANDARD_NAMESPACES)) {
      try {
        this.discoverNamespace(namespace, config.modules, config.basePath);
      } catch (error) {
        logger.warn(`Failed to register namespace ${namespace}, continuing with other namespaces:`, error);
      }
    }
  }
  
  /**
   * Discovers modules in a namespace
   */
  private discoverNamespace(namespace: string, modules: string[], basePath: string): void {
    for (const module of modules) {
      try {
        const importPath = `${basePath}/${namespace}/${module}/tx`;
        let protoModule;
        
        try {
          // First try the original path
          const relativePath = basePath.startsWith('..') 
            ? importPath 
            : `${basePath}/${namespace}/${module}/tx`;
          
          protoModule = require(relativePath);
        } catch (e) {
          // If that fails, try using the path aliases
          try {
            if (basePath.includes('generated/proto')) {
              // Try with the new path alias approach
              const aliasPath = `@protos/${namespace}/${module}/tx`;
              protoModule = require(aliasPath);
            } else if (basePath === 'cosmjs-types') {
              // For cosmjs types, just continue with the original approach
              logger.warn(`Could not load module: ${importPath}`, e);
              continue;
            } else {
              // For any other paths, try an absolute path as fallback
              const absolutePath = path.join(process.cwd(), `src/generated/proto/${namespace}/${module}/tx`);
              protoModule = require(absolutePath);
            }
          } catch (aliasError) {
            logger.warn(`Could not load module: ${importPath} with any method`, e);
            continue;
          }
        }
        
        this.registerModuleMessages(protoModule, namespace, module);
      } catch (e) {
        logger.warn(`Error processing namespace ${namespace} module ${module}`, e);
      }
    }
  }
  
  /**
   * Auto-discover proto modules in generated directory
   */
  private discoverGeneratedProtos(): void {
    try {
      // Using path resolution that will work with the new aliases
      const generatedBaseDir = path.resolve(process.cwd(), 'src/generated/proto');
      
      if (fs.existsSync(generatedBaseDir)) {
        this.scanDirectory(generatedBaseDir);
      } else {
        // Fallback to legacy path resolution
        const fallbackDir = path.resolve(__dirname, '../../../generated/proto');
        if (fs.existsSync(fallbackDir)) {
          this.scanDirectory(fallbackDir);
        } else {
          logger.warn(`Generated proto directory not found at expected locations. 
            Tried: ${generatedBaseDir} and ${fallbackDir}`);
        }
      }
    } catch (error) {
      logger.warn('Failed to auto-discover proto modules:', error);
    }
  }
  
  /**
   * Scan directory recursively for proto modules
   */
  private scanDirectory(baseDir: string, currentPath: string = ''): void {
    try {
      const fullPath = path.join(baseDir, currentPath);
      const items = fs.readdirSync(fullPath);
      
      for (const item of items) {
        const itemPath = path.join(fullPath, item);
        const relativePath = path.join(currentPath, item);
        const stats = fs.statSync(itemPath);
        
        if (stats.isDirectory()) {
          this.scanDirectory(baseDir, relativePath);
        } else if (item === 'tx.js' || item === 'tx.cjs') {
          this.registerTxModule(baseDir, currentPath, relativePath);
        }
      }
    } catch (error) {
      logger.warn(`Error scanning directory ${currentPath}:`, error);
    }
  }
  
  /**
   * Register tx module file
   */
  private registerTxModule(baseDir: string, currentPath: string, relativePath: string): void {
    try {
      // Try importing via relative path first
      try {
        const importPath = `@protos/${currentPath.replace(/\\/g, '/').replace(/\.js$/, '')}`;
        const protoModule = require(importPath);
        
        // Get namespace from path (convert path segments to dot notation for typeUrl)
        const pathSegments = currentPath.split(path.sep).filter(s => s !== 'proto' && s !== 'tx.js' && s !== 'tx.cjs');
        const namespace = pathSegments.join('.');
        
        this.registerProtoModuleMessages(protoModule, namespace);
      } catch (requireError) {
        // If relative import fails, try with absolute path using cwd
        const absolutePath = path.join(process.cwd(), 'src/generated/proto', 
          currentPath.replace(/\\/g, '/').replace(/\.js$/, ''));
          
        try {
          const protoModule = require(absolutePath);
          
          // Get namespace from path (convert path segments to dot notation for typeUrl)
          const pathSegments = currentPath.split(path.sep).filter(s => s !== 'proto' && s !== 'tx.js' && s !== 'tx.cjs');
          const namespace = pathSegments.join('.');
          
          this.registerProtoModuleMessages(protoModule, namespace);
        } catch (absError) {
          // Both approaches failed, log the error
          throw new Error(`Failed to import module with both relative and absolute paths`);
        }
      }
    } catch (error) {
      logger.warn(`Failed to load proto module from ${relativePath}:`, error);
    }
  }
  
  /**
   * Register all message types from a proto module (generic)
   */
  private registerProtoModuleMessages(protoModule: any, namespace: string): void {
    for (const key in protoModule) {
      if (key.startsWith('Msg')) {
        const typeUrl = `/${namespace}.${key}`;
        
        this.decoderRegistry.set(typeUrl, (value: Uint8Array) => {
          return protoModule[key].decode(value);
        });
        
        logger.debug(`Registered message type: ${typeUrl}`);
      }
    }
  }
  
  /**
   * Register messages from a specific module
   */
  private registerModuleMessages(protoModule: any, namespace: string, module: string): void {
    for (const key in protoModule) {
      if (key.startsWith('Msg')) {
        const typeUrl = `/${namespace}.${module.replace('/', '.')}.${key}`;
        
        this.decoderRegistry.set(typeUrl, (value: Uint8Array) => {
          return protoModule[key].decode(value);
        });
      }
    }
  }
  
  /**
   * Build potential module paths to try for dynamic decoding
   */
  public static buildModulePaths(parts: string[]): Array<{path: string; msgType: string}> {
    const attemptPaths: Array<{path: string; msgType: string}> = [];
    
    if (parts.length >= 3) {
      // Standard format: namespace.module.version.MsgType 
      // e.g., ibc.core.client.v1.MsgUpdateClient
      const namespace = parts[0];
      const modulePath = parts.slice(1, -1).join('/');
      const msgType = parts[parts.length - 1];
      
      // Düzeltildi: Doğru yollar
      attemptPaths.push({
        path: `../../../generated/proto/${namespace}/${modulePath}/tx`,
        msgType
      });
      
      // For Cosmos SDK modules
      if (namespace === 'cosmos') {
        attemptPaths.push({
          path: `cosmjs-types/${namespace}/${modulePath}/tx`,
          msgType
        });
      }
      
      // For other paths that may follow different conventions
      const altModulePath = parts.slice(0, -1).join('/');
      attemptPaths.push({
        path: `../../../generated/proto/${altModulePath}/tx`,
        msgType
      });
    }
    
    return attemptPaths;
  }
} 