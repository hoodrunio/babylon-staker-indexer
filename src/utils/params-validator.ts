import { Database } from '../database';
import { getPhaseConfig, getPhaseForHeight, PhaseConfig } from '../config/phase-config';

interface PhaseEndCondition {
  type: 'total_stake' | 'block_height';
  value: number;
}

interface VersionParams {
  version: number;
  phase: number;
  activation_height: number;
  cap_height?: number;
  timeout_height?: number;
  staking_cap?: number;
  tag: string;
  covenant_pks: string[];
  covenant_quorum: number;
  unbonding_time: number;
  unbonding_fee: number;
  max_staking_amount: number;
  min_staking_amount: number;
  max_staking_time: number;
  min_staking_time: number;
  confirmation_depth: number;
}

interface GlobalParams {
  versions: VersionParams[];
}

let cachedParams: GlobalParams | null = null;
const dbInstance = Database.getInstance();

async function loadParams(): Promise<GlobalParams> {
  if (cachedParams) {
    return cachedParams;
  }
  
  try {
    const params = require('../../global-params.json');
    cachedParams = params;
    return params;
  } catch (e) {
    console.error('Error loading parameters:', e);
    throw e;
  }
}

async function checkPhaseCondition(phase: PhaseConfig): Promise<boolean> {
  await dbInstance.connect();
  
  switch (phase.endCondition.type) {
    case 'total_stake':
      const stats = await dbInstance.getGlobalStats();
      return (stats.totalStakeBTC * 100000000) >= phase.endCondition.value;
      
    case 'block_height':
      const lastBlock = await dbInstance.getLastProcessedBlock();
      return lastBlock >= phase.endCondition.value;
      
    default:
      return false;
  }
}

export async function getParamsForHeight(height: number): Promise<VersionParams | null> {
  try {
    const params = await loadParams();
    
    // Find the version parameters that match the height only
    const versionParams = params.versions.find(v => {
      return height >= v.activation_height && (!v.cap_height || height <= v.cap_height);
    });

    if (!versionParams) {
      return null;
    }

    // Return version parameters as is - no special handling needed
    return versionParams;
  } catch (error) {
    console.error('Error getting parameters for height:', error);
    return null;
  }
}