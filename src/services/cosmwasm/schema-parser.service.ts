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
   * @returns Array of query method names
   */
  public static extractQueryMethods(schemaPath: string): string[] {
    try {
      const querySchemaPath = path.join(schemaPath, 'query_msg.json');
      
      if (!fs.existsSync(querySchemaPath)) {
        logger.warn(`Query schema file not found at ${querySchemaPath}`);
        return [];
      }
      
      const querySchema = JSON.parse(fs.readFileSync(querySchemaPath, 'utf8'));
      
      // Extract root keys from "oneOf" array if it exists
      if (querySchema.oneOf && Array.isArray(querySchema.oneOf)) {
        return this.extractMethodsFromOneOf(querySchema.oneOf);
      }
      
      // Extract root keys from properties if it exists
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
   * @returns Array of execute method names
   */
  public static extractExecuteMethods(schemaPath: string): string[] {
    try {
      const executeSchemaPath = path.join(schemaPath, 'execute_msg.json');
      
      if (!fs.existsSync(executeSchemaPath)) {
        logger.warn(`Execute schema file not found at ${executeSchemaPath}`);
        return [];
      }
      
      const executeSchema = JSON.parse(fs.readFileSync(executeSchemaPath, 'utf8'));
      
      // Extract root keys from "oneOf" array if it exists
      if (executeSchema.oneOf && Array.isArray(executeSchema.oneOf)) {
        return this.extractMethodsFromOneOf(executeSchema.oneOf);
      }
      
      // Extract root keys from properties if it exists
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
   * @returns Array of method names
   */
  private static extractMethodsFromOneOf(oneOf: any[]): string[] {
    const methods: string[] = [];
    
    for (const item of oneOf) {
      if (item.properties) {
        const keys = Object.keys(item.properties);
        if (keys.length === 1) {
          methods.push(keys[0]);
        }
      }
    }
    
    return methods;
  }
}
