/**
 * Validator Info Adapter
 * Adapts ValidatorInfoService to IValidatorInfoAdapter interface
 */

import { IValidatorInfoAdapter } from './IValidatorInfoAdapter';
import { ValidatorInfoService } from '../../../../services/validator/ValidatorInfoService';
import { Network } from '../../../../types/finality';
import { logger } from '../../../../utils/logger';
import { Types } from 'mongoose';

export class ValidatorInfoAdapter implements IValidatorInfoAdapter {
  private static instance: ValidatorInfoAdapter | null = null;
  private validatorInfoService: ValidatorInfoService | null = null;
  
  private constructor() {
    // Private constructor to enforce singleton pattern
    this.initializeValidatorInfoService();
  }
  
  /**
   * Initialize validator info service
   */
  private initializeValidatorInfoService(): void {
    try {
      this.validatorInfoService = ValidatorInfoService.getInstance();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`[ValidatorInfoAdapter] ValidatorInfoService initialization failed: ${errorMessage}`);
    }
  }
  
  /**
   * Singleton instance
   */
  public static getInstance(): ValidatorInfoAdapter {
    if (!ValidatorInfoAdapter.instance) {
      ValidatorInfoAdapter.instance = new ValidatorInfoAdapter();
    }
    return ValidatorInfoAdapter.instance;
  }
  
  /**
   * Format error message consistently
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  
  /**
   * Gets validator by hex address
   */
  public async getValidatorByHexAddress(hexAddress: string): Promise<any | null> {
    if (!this.validatorInfoService) {
      logger.error(`[ValidatorInfoAdapter] ValidatorInfoService is not available`);
      return null;
    }
    
    try {
      return await this.validatorInfoService.getValidatorByHexAddress(hexAddress);
    } catch (error) {
      logger.error(`[ValidatorInfoAdapter] Error getting validator by hex address: ${this.formatError(error)}`);
      return null;
    }
  }
  
  /**
   * Gets validator by ID
   */
  public async getValidatorById(id: Types.ObjectId): Promise<any | null> {
    if (!this.validatorInfoService) {
      logger.error(`[ValidatorInfoAdapter] ValidatorInfoService is not available`);
      return null;
    }
    
    try {
      return await this.validatorInfoService.getValidatorById(id.toString());
    } catch (error) {
      logger.error(`[ValidatorInfoAdapter] Error getting validator by ID: ${this.formatError(error)}`);
      return null;
    }
  }
} 