import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';
import { SchemaExecuteParserService } from './schema-execute-parser.service';

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
      // Try standard location first
      const querySchemaPath = path.join(schemaPath, 'query.json');
      
      // Try schema/raw/ location if standard doesn't exist
      const rawQuerySchemaPath = path.join(schemaPath, 'raw', 'query.json');
      
      let schemaFilePath = '';
      
      if (fs.existsSync(querySchemaPath)) {
        schemaFilePath = querySchemaPath;
      } else if (fs.existsSync(rawQuerySchemaPath)) {
        schemaFilePath = rawQuerySchemaPath;
      } else {
        logger.warn(`Query schema file not found at ${querySchemaPath} or ${rawQuerySchemaPath}`);
        return [];
      }
      
      const querySchema = JSON.parse(fs.readFileSync(schemaFilePath, 'utf8'));
      
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
      // Try standard location first
      const executeSchemaPath = path.join(schemaPath, 'execute.json');
      
      // Try schema/raw/ location if standard doesn't exist
      const rawExecuteSchemaPath = path.join(schemaPath, 'raw', 'execute.json');
      
      let schemaFilePath = '';
      
      if (fs.existsSync(executeSchemaPath)) {
        schemaFilePath = executeSchemaPath;
      } else if (fs.existsSync(rawExecuteSchemaPath)) {
        schemaFilePath = rawExecuteSchemaPath;
      } else {
        logger.warn(`Execute schema file not found at ${executeSchemaPath} or ${rawExecuteSchemaPath}`);
        return [];
      }
      
      const executeSchema = JSON.parse(fs.readFileSync(schemaFilePath, 'utf8'));
      
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
   * Extract execute schema details for frontend form generation
   * @param schemaPath Path to the schema directory
   * @returns Detailed execute schema information
   */
  public static extractExecuteSchemaDetails(schemaPath: string): any[] {
    try {
      // Use the new SchemaExecuteParserService to get detailed schema
      return SchemaExecuteParserService.parseExecuteSchema(schemaPath);
    } catch (error) {
      logger.error('Error extracting execute schema details:', error);
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
