import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';

/**
 * Service for parsing CosmWasm schema files to extract query and execute methods
 */
export class SchemaParserService {
  /**
   * Extract query methods from schema files
   * @param schemaPath Path to the schema directory
   */
  public static extractQueryMethods(schemaPath: string): string[] {
    try {
      const querySchemaPath = path.join(schemaPath, 'query.json');
      
      if (!fs.existsSync(querySchemaPath)) {
        logger.warn(`Query schema file not found at ${querySchemaPath}`);
        return [];
      }
      
      const querySchema = JSON.parse(fs.readFileSync(querySchemaPath, 'utf8'));
      
      // First try to handle oneOf structure
      if (querySchema.oneOf && Array.isArray(querySchema.oneOf)) {
        return this.extractMethodsFromOneOf(querySchema.oneOf);
      }
      
      // Fallback to properties if no oneOf
      if (querySchema.properties) {
        return Object.keys(querySchema.properties);
      }
      
      logger.warn('Could not find query methods in schema');
      return [];
    } catch (error) {
      logger.error('Error extracting query methods from schema:', error);
      return [];
    }
  }
  
  /**
   * Extract execute methods from schema files
   * @param schemaPath Path to the schema directory
   */
  public static extractExecuteMethods(schemaPath: string): string[] {
    try {
      const executeSchemaPath = path.join(schemaPath, 'execute.json');
      
      if (!fs.existsSync(executeSchemaPath)) {
        logger.warn(`Execute schema file not found at ${executeSchemaPath}`);
        return [];
      }
      
      const executeSchema = JSON.parse(fs.readFileSync(executeSchemaPath, 'utf8'));
      
      // First try to handle oneOf structure
      if (executeSchema.oneOf && Array.isArray(executeSchema.oneOf)) {
        return this.extractMethodsFromOneOf(executeSchema.oneOf);
      }
      
      // Fallback to properties if no oneOf
      if (executeSchema.properties) {
        return Object.keys(executeSchema.properties);
      }
      
      logger.warn('Could not find execute methods in schema');
      return [];
    } catch (error) {
      logger.error('Error extracting execute methods from schema:', error);
      return [];
    }
  }
  
  /**
   * Extract methods from oneOf array in schema
   * @param oneOf oneOf array from schema
   */
  private static extractMethodsFromOneOf(oneOf: any[]): string[] {
    try {
      const methods: string[] = [];
      
      for (const item of oneOf) {
        if (item.properties) {
          const keys = Object.keys(item.properties);
          if (keys.length > 0) {
            methods.push(keys[0]);
          }
        }
      }
      
      return methods;
    } catch (error) {
      logger.error('Error extracting methods from oneOf:', error);
      return [];
    }
  }
}
