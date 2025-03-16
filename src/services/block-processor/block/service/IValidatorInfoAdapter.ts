/**
 * Validator Info Adapter Interface
 * Abstracts validator information retrieval operations
 */

import { Network } from '../../../../types/finality';
import { Types } from 'mongoose';

export interface IValidatorInfoAdapter {
  /**
   * Gets validator by hex address
   */
  getValidatorByHexAddress(hexAddress: string, network: Network): Promise<any | null>;
  
  /**
   * Gets validator by ID
   */
  getValidatorById(id: Types.ObjectId): Promise<any | null>;
} 