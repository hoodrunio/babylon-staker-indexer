import { Database } from '../database';
import { PhaseConfig, getPhaseConfig, getPhaseForHeight } from '../config/phase-config';

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
    
    // Add phase numbers to versions
    params.versions = params.versions.map((v: any) => ({
      ...v,
      phase: v.version + 1 // Convert version to phase number
    }));
    
    cachedParams = params;

    // Log phase parameters
    console.log('\n=== Phase Parameters ===');
    params.versions.forEach((version: VersionParams) => {
      console.log(`\nPhase ${version.phase}:`);
      console.log(`  Version: ${version.version}`);
      console.log(`  Activation Height: ${version.activation_height}`);
      console.log(`  Cap Height: ${version.cap_height || 'N/A'}`);
      console.log(`  Min Staking Amount: ${version.min_staking_amount / 100000000} BTC`);
      console.log(`  Max Staking Amount: ${version.max_staking_amount / 100000000} BTC`);
      if (version.phase === 1) {
        console.log(`  Target Stake: ${parseInt(process.env.PHASE1_TARGET_STAKE || '0') / 100000000} BTC`);
        console.log(`  Timeout Height: ${process.env.PHASE1_TIMEOUT_HEIGHT}`);
      }
    });
    console.log('\n===================\n');

    return params;
  } catch (e) {
    console.error('Error loading parameters:', e);
    throw e;
  }
}

async function findApplicableVersion(height: number, versions: VersionParams[], dbInstance: Database): Promise<VersionParams | null> {
  // Consider it reindexing if INDEX_SPECIFIC_PHASE is true
  const isReindexing = process.env.INDEX_SPECIFIC_PHASE === 'true';

  for (const version of versions) {
    // Use environment variables for heights based on phase
    const startHeight = parseInt(process.env[`PHASE${version.phase}_START_HEIGHT`] || version.activation_height.toString());
    const endHeight = version.phase === 1 ? 
      parseInt(process.env.PHASE1_TIMEOUT_HEIGHT || '858000') :
      parseInt(process.env[`PHASE${version.phase}_END_HEIGHT`] || (version.cap_height || '0').toString());
    
    if (height < startHeight || height > endHeight) {
      continue;
    }

    // For Phase 1, check total stake only if we're not reindexing
    if (version.phase === 1 && !isReindexing) {
      // Get phase-specific stats
      const phaseStats = await dbInstance.getPhaseStats(version.phase);
      if (phaseStats && phaseStats.totalStakeBTC && version.staking_cap !== undefined) {
        const totalStake = phaseStats.totalStakeBTC * 100000000;
        if (totalStake >= version.staking_cap) {
          continue;
        }
      }
    }
    
    return version;
  }
  
  return null;
}

async function checkPhase1End(currentStake: number): Promise<boolean> {
  const targetStake = parseInt(process.env.PHASE1_TARGET_STAKE || '100000000000');
  return currentStake >= targetStake;
}

export async function getParamsForHeight(height: number): Promise<VersionParams | null> {
  try {
    const params = await loadParams();
    const dbInstance = Database.getInstance();
    const isReindexing = process.env.INDEX_SPECIFIC_PHASE === 'true';
    
    const applicableVersion = await findApplicableVersion(height, params.versions, dbInstance);

    if (!applicableVersion) {
      console.log(`No applicable version found for height ${height}`);
      return null;
    }

    // For Phase 1, check target stake only if not reindexing
    if (applicableVersion.phase === 1 && !isReindexing) {
      const stats = await dbInstance.getGlobalStats();
      const totalStake = stats.totalStakeBTC * 100000000;
      const isPhase1Complete = await checkPhase1End(totalStake);
      
      if (isPhase1Complete) {
        console.log(`Phase 1 completed at height ${height} due to reaching target stake`);
        return null;
      }
    }

    return {
      ...applicableVersion,
      // Use the exact activation height from the version
      activation_height: applicableVersion.activation_height
    };
  } catch (error) {
    console.error('Error getting parameters for height:', error);
    return null;
  }
}