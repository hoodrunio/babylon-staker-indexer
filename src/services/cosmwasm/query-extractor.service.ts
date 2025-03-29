import { CosmWasmClient } from '../../clients/CosmWasmClient';
import { Contract } from '../../database/models/cosmwasm';
import { logger } from '../../utils/logger';

/**
 * Service for extracting query methods from contracts by analyzing error messages
 */
export class QueryMethodExtractor {
  private readonly client: CosmWasmClient;

  /**
   * Create a new QueryMethodExtractor
   * @param client CosmWasmClient instance
   */
  constructor(client: CosmWasmClient) {
    this.client = client;
  }

  /**
   * Extract query methods for a contract
   * @param contractAddress The contract address to extract methods for
   * @returns Array of query method names or null if extraction failed
   */
  public async extractQueryMethods(contractAddress: string): Promise<string[] | null> {
    try {
      // Use invalid query to trigger error message with valid methods
      // The "100000" is just a random string that won't be a valid query method
      const invalidQuery = { "100000": {} };
      
      // Try to execute the query with retries disabled (we expect this to fail)
      await this.client.queryContract(contractAddress, invalidQuery, { retry: false });
      
      // If we get here, the query somehow succeeded! This should never happen with our invalid query
      logger.warn(`Query extraction: Invalid query unexpectedly succeeded for ${contractAddress}`);
      return null;
      
    } catch (error: any) {
      // Handle different API error scenarios
      if (error.response) {
        const statusCode = error.response.status;
        const errorMessage = error.response.data?.message || error.response.data?.error || error.message;
        
        // Handle 501 Not Implemented error - API endpoint might not be supported
        if (statusCode === 501) {
          logger.warn(`The chain does not support smart query endpoint for ${contractAddress}. Skipping method extraction.`);
          return null;
        }
        
        // Try to extract methods from error message regardless of status code
        // This includes 400 Bad Request and 500 Internal Server Error
        if (errorMessage && typeof errorMessage === 'string') {
          const methods = this.extractMethodsFromErrorMessage(errorMessage);
          if (methods) {
            // Only log at debug level since this is expected behavior
            logger.debug(`Successfully extracted methods from ${statusCode} error for ${contractAddress}`);
            return methods;
          }
        }
        
        // Only log unexpected errors (not the ones we expect for method extraction)
        if (!errorMessage?.includes('unknown variant') && !errorMessage?.includes('Missing export query')) {
          logger.error(`Unexpected API response (${statusCode}) for ${contractAddress}: ${errorMessage || 'No error message'}`);
        }
      }
      
      // Only log unexpected errors
      if (!error.response?.data?.message?.includes('unknown variant') && 
          !error.response?.data?.message?.includes('Missing export query')) {
        logger.error(`Failed to extract query methods for ${contractAddress}:`, error);
      }
      return null;
    }
  }

  /**
   * Extract method names from error message using regex
   * @param errorMessage Error message from the API
   * @returns Array of method names or null if extraction failed
   */
  private extractMethodsFromErrorMessage(errorMessage: string): string[] | null {
    try {
      // Log the complete error message for debugging
      logger.debug(`Query extraction error message: ${errorMessage}`);
      
      // Check if the error message indicates missing query export
      if (errorMessage.includes('Missing export query')) {
        logger.info('Contract does not support queries (no query export)');
        return [];
      }

      // Check if the error message is just "Not Implemented"
      if (errorMessage === "Not Implemented") {
        logger.warn("Received 'Not Implemented' error message, endpoint might not be supported");
        return null;
      }

      // Try to extract methods from different error message formats
      let methods: string[] = [];

      // Format 1: Error parsing into type X: unknown variant `Y`, expected one of `method1`, `method2`, ...
      const fullMatch = errorMessage.match(/expected one of `([^`]+(?:`,\s*`[^`]+)*)`/);
      if (fullMatch && fullMatch[1]) {
        methods = fullMatch[1].split(/`,\s*`/);
        logger.info(`Successfully extracted ${methods.length} query methods (full format)`);
        return methods;
      }

      // Format 2: unknown variant `Y`, expected one of `method1`, `method2`, ...
      const altMatch = errorMessage.match(/unknown variant .*?, expected one of `([^`]+(?:`,\s*`[^`]+)*)`/);
      if (altMatch && altMatch[1]) {
        methods = altMatch[1].split(/`,\s*`/);
        logger.info(`Successfully extracted ${methods.length} query methods (alt format)`);
        return methods;
      }

      // Format 3: expected `method1` or `method2`
      const orMatch = errorMessage.match(/expected `([^`]+)` or `([^`]+)`/);
      if (orMatch) {
        methods = [orMatch[1], orMatch[2]];
        logger.info(`Successfully extracted ${methods.length} query methods (or format)`);
        return methods;
      }

      // Format 4: expected `method`
      const singleMatch = errorMessage.match(/expected `([^`]+)`/);
      if (singleMatch && singleMatch[1]) {
        methods = [singleMatch[1]];
        logger.info(`Successfully extracted single query method`);
        return methods;
      }

      // If no methods found, log warning and return null
      logger.warn(`Could not find method list in error message: ${errorMessage}`);
      return null;

    } catch (error) {
      logger.error('Error parsing methods from error message:', error);
      return null;
    }
  }
} 