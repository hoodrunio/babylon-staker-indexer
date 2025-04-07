import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';

/**
 * Interface for execute method parameter
 */
interface MethodArg {
  name: string;
  type: string;
  format?: string;
  required: boolean;
  description?: string;
}

/**
 * Interface for execute method
 */
interface Method {
  method: string;
  args: MethodArg[];
}

/**
 * Execute schema parser service
 */
export class SchemaExecuteParserService {
  /**
   * Parses the execute schema and returns a list of methods
   * @param schemaPath Schema directory path
   * @returns Array containing methods
   */
  public static parseExecuteSchema(schemaPath: string): Method[] {
    try {
      // Try standard schema location
      const executeSchemaPath = path.join(schemaPath, 'execute.json');
      
      // Alternative location: schema/raw/
      const rawExecuteSchemaPath = path.join(schemaPath, 'raw', 'execute.json');
      
      let schemaFilePath = '';
      
      // Check if the schema file exists
      if (fs.existsSync(executeSchemaPath)) {
        schemaFilePath = executeSchemaPath;
      } else if (fs.existsSync(rawExecuteSchemaPath)) {
        schemaFilePath = rawExecuteSchemaPath;
      } else {
        logger.warn(`Execute schema not found: ${executeSchemaPath} or ${rawExecuteSchemaPath}`);
        return [];
      }
      
      // Read and parse the schema file
      const schema = JSON.parse(fs.readFileSync(schemaFilePath, 'utf8'));
      
      // Check the oneOf structure
      if (!schema.oneOf || !Array.isArray(schema.oneOf)) {
        logger.warn('Invalid oneOf structure found in execute schema');
        return [];
      }
      
      // Extract methods
      return this.extractMethods(schema.oneOf);
    } catch (error) {
      logger.error('Error parsing execute schema:', error);
      return [];
    }
  }
  
  /**
   * Extracts method information from the oneOf structure
   * @param oneOf oneOf structure
   * @returns Method array
   */
  private static extractMethods(oneOf: any[]): Method[] {
    const methods: Method[] = [];
    
    for (const variant of oneOf) {
      // Check variant requirements
      if (!variant.required || !variant.properties) {
        continue;
      }
      
      // Find method name
      const methodName = variant.required[0];
      if (!methodName || !variant.properties[methodName]) {
        continue;
      }
      
      const methodProperties = variant.properties[methodName];
      
      // Extract method arguments
      const args: MethodArg[] = this.extractMethodArgs(methodProperties);
      
      // Add method to the list
      methods.push({
        method: methodName,
        args
      });
    }
    
    return methods;
  }
  
  /**
   * Extracts arguments from method properties
   * @param methodProperties Method properties
   * @returns Argument array
   */
  private static extractMethodArgs(methodProperties: any): MethodArg[] {
    const args: MethodArg[] = [];
    
    // Check method properties
    if (!methodProperties.properties) {
      return args;
    }
    
    // Determine required fields
    const requiredFields = methodProperties.required || [];
    
    // Add each property as an argument
    for (const [argName, argProps] of Object.entries<any>(methodProperties.properties)) {
      const arg: MethodArg = {
        name: argName,
        type: argProps.type || 'unknown',
        required: requiredFields.includes(argName)
      };
      
      // Add additional properties
      if (argProps.format) {
        arg.format = argProps.format;
      }
      
      if (argProps.description) {
        arg.description = argProps.description;
      }
      
      // Process nested objects
      if (arg.type === 'object' && argProps.properties) {
        // Here we can also process nested structures, but for now we keep it simple
        arg.type = 'object';
      }
      
      // Process arrays
      if (arg.type === 'array' && argProps.items) {
        arg.type = 'array';
      }
      
      args.push(arg);
    }
    
    return args;
  }
}