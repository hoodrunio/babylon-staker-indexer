import dotenv from 'dotenv';
import { Database } from '../database';

dotenv.config();

export interface PhaseEndCondition {
  type: 'total_stake' | 'block_height';
  value: number;
  inactivityThreshold?: {
    blocks: number;           // Number of blocks to check for inactivity
    minTotalStake: number;    // Minimum total stake before inactivity check applies
    stakeDifference: number;  // Maximum allowed difference from target stake
  };
}

export interface PhaseConfig {
  phase: number;
  startHeight: number;
  endCondition: PhaseEndCondition;
  timeoutHeight?: number;
}

export interface StakingPhaseConfig {
  phases: PhaseConfig[];
}

// Environment variable parsing with defaults
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getPhase1Config(): PhaseConfig {
  return {
    phase: 1,
    startHeight: getEnvNumber('PHASE1_START_HEIGHT', 857910),
    endCondition: {
      type: 'total_stake',
      value: getEnvNumber('PHASE1_TARGET_STAKE', 100000000000),
      inactivityThreshold: {
        blocks: getEnvNumber('PHASE1_INACTIVITY_BLOCKS', 20),
        minTotalStake: getEnvNumber('PHASE1_MIN_TOTAL_STAKE', 95000000000),
        stakeDifference: getEnvNumber('PHASE1_STAKE_DIFFERENCE', 5000000000)
      }
    },
    timeoutHeight: getEnvNumber('PHASE1_TIMEOUT_HEIGHT', 864789)
  };
}

function getPhase2Config(): PhaseConfig {
  return {
    phase: 2,
    startHeight: getEnvNumber('PHASE2_START_HEIGHT', 864790),
    endCondition: {
      type: 'block_height',
      value: getEnvNumber('PHASE2_END_HEIGHT', 874087) // End right before Phase 3 starts
    }
  };
}

function getPhase3Config(): PhaseConfig {
  return {
    phase: 3,
    startHeight: getEnvNumber('PHASE3_START_HEIGHT', 874088),
    endCondition: {
      type: 'block_height',
      value: getEnvNumber('PHASE3_END_HEIGHT', 875087)
    }
  };
}

// Default phase configuration
const defaultPhaseConfig: StakingPhaseConfig = {
  phases: [
    getPhase1Config(),
    getPhase2Config(),
    getPhase3Config()
  ]
};

export function getPhaseConfig(): StakingPhaseConfig {
  try {
    // Allow complete override through environment variables
    const phaseConfigStr = process.env.STAKING_PHASE_CONFIG;
    if (phaseConfigStr) {
      return JSON.parse(phaseConfigStr);
    }
    
    // Use individual environment variables
    return {
      phases: [
        getPhase1Config(),
        getPhase2Config(),
        getPhase3Config()
      ]
    };
  } catch (error) {
    console.warn('Error parsing phase config from environment, using default:', error);
    return defaultPhaseConfig;
  }
}

export function getPhaseForHeight(height: number): PhaseConfig | null {
  const config = getPhaseConfig();
  
  for (const phase of config.phases) {
    if (height >= phase.startHeight) {
      // Check if we're within the phase's valid range
      if (phase.timeoutHeight && height > phase.timeoutHeight) {
        continue;
      }
      
      if (phase.endCondition.type === 'block_height' && height > phase.endCondition.value) {
        continue;
      }
      
      return phase;
    }
  }
  
  return null;
}

async function checkInactivityCondition(phase: PhaseConfig, currentHeight: number): Promise<boolean> {
  const db = new Database();
  const { inactivityThreshold } = phase.endCondition;
  
  if (!inactivityThreshold) {
    return false;
  }

  // Get current total stake
  const stats = await db.getGlobalStats();
  const currentTotalStake = Math.floor(stats.totalStakeBTC * 100000000);

  // Check if we're close enough to target to consider inactivity
  if (currentTotalStake < inactivityThreshold.minTotalStake) {
    return false;
  }

  // Check if we're within stakeDifference of the target
  const targetStake = phase.endCondition.value;
  const stakeGap = targetStake - currentTotalStake;
  if (stakeGap > inactivityThreshold.stakeDifference) {
    return false;
  }

  // Check for inactivity in recent blocks
  const startBlock = Math.max(phase.startHeight, currentHeight - inactivityThreshold.blocks);
  const transactions = await db.getTransactionsByBlockRange(startBlock, currentHeight);
  
  // If no transactions in the last N blocks and we're close to target, end the phase
  return transactions.length === 0;
}

export async function checkPhaseCondition(phase: PhaseConfig, currentHeight: number): Promise<boolean> {
  const db = new Database();
  
  switch (phase.endCondition.type) {
    case 'total_stake': {
      const stats = await db.getGlobalStats();
      const currentTotalStake = Math.floor(stats.totalStakeBTC * 100000000);
      
      // Check primary condition (total stake reached)
      if (currentTotalStake >= phase.endCondition.value) {
        console.log(`Phase ${phase.phase} ending: Total stake target reached (${currentTotalStake} >= ${phase.endCondition.value})`);
        return true;
      }
      
      // Check inactivity condition
      const isInactive = await checkInactivityCondition(phase, currentHeight);
      if (isInactive) {
        console.log(`Phase ${phase.phase} ending: Inactivity threshold reached near target stake`);
        return true;
      }
      
      return false;
    }
      
    case 'block_height': {
      const lastBlock = await db.getLastProcessedBlock();
      return lastBlock >= phase.endCondition.value;
    }
      
    default:
      return false;
  }
}
