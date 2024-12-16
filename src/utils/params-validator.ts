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
  const db = new Database();
  
  switch (phase.endCondition.type) {
    case 'total_stake':
      const stats = await db.getGlobalStats();
      return (stats.totalStakeBTC * 100000000) >= phase.endCondition.value;
      
    case 'block_height':
      const lastBlock = await db.getLastProcessedBlock();
      return lastBlock >= phase.endCondition.value;
      
    default:
      return false;
  }
}

export async function getParamsForHeight(height: number, txVersion?: number): Promise<VersionParams | null> {
  try {
    const params = await loadParams();
    
    // console.log(`\nLooking for parameters at height ${height} (tx version: ${txVersion})`);
    
    // Get current phase configuration
    const currentPhase = getPhaseForHeight(height);
    if (!currentPhase) {
      console.log(`No active phase found for height ${height}`);
      return null;
    }
    
    // If tx_version is provided, first try to find matching version
    if (txVersion !== undefined) {
      for (const version of params.versions) {
        if (version.version === txVersion && version.activation_height <= height) {
          // Check if phase is still active
          const phaseEnded = await checkPhaseCondition(currentPhase);
          if (phaseEnded) {
            console.log(`Phase ${currentPhase.phase} conditions have been met`);
            continue;
          }
          
          console.log(`Found matching version ${version.version} for tx`);
          return version;
        }
      }
    }
    
    // If no matching version found, find latest applicable version
    for (const version of [...params.versions].reverse()) {
      if (version.activation_height <= height) {
        // Check if phase is still active
        const phaseEnded = await checkPhaseCondition(currentPhase);
        if (phaseEnded) {
          continue;
        }
        
        console.log(`Using version ${version.version}`);
        return version;
      }
    }
    
    console.log("No valid parameters found");
    return null;
    
  } catch (e) {
    console.error(`Error loading parameters:`, e);
    return null;
  }
}