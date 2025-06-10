import { Database } from '../database';
import { logger } from './logger';
import params from '../../global-params.json';

export interface VersionParams {
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
    // Add phase numbers to versions
    params.versions = params.versions.map((v: any) => ({
      ...v,
      phase: v.version + 1 // Convert version to phase number
    }));
    
    cachedParams = params as GlobalParams;

    // Log phase parameters
    logger.info('\n=== Phase Parameters ===');
    params.versions.forEach((version: any) => {
      logger.info(`\nPhase ${version.phase}:`);
      logger.info(`  Version: ${version.version}`);
      logger.info(`  Activation Height: ${version.activation_height}`);
      logger.info(`  Cap Height: ${version.cap_height || 'N/A'}`);
      logger.info(`  Min Staking Amount: ${version.min_staking_amount / 100000000} BTC`);
      logger.info(`  Max Staking Amount: ${version.max_staking_amount / 100000000} BTC`);
      if (version.phase === 1) {
        logger.info(`  Target Stake: ${parseInt(process.env.PHASE1_TARGET_STAKE || '0') / 100000000} BTC`);
        logger.info(`  Timeout Height: ${process.env.PHASE1_TIMEOUT_HEIGHT}`);
      }
    });
    logger.info('\n===================\n');

    return params as GlobalParams;
  } catch (e) {
    logger.error('Error loading parameters:', e);
    throw e;
  }
}

async function findApplicableVersion(height: number, versions: any[], dbInstance: Database): Promise<any | null> {
  // Consider it reindexing if INDEX_SPECIFIC_PHASE is true
  const isReindexing = process.env.INDEX_SPECIFIC_PHASE === 'true';

  // Find the version configurations for each phase
  const phase1Version = versions.find(v => v.phase === 1);
  const phase2Version = versions.find(v => v.phase === 2);
  const phase3Version = versions.find(v => v.phase === 3);

  if (!phase1Version || !phase2Version || !phase3Version) {
    logger.error('Missing phase configurations in global-params.json');
    return null;
  }

  for (const version of versions) {
    let startHeight = 0;
    let endHeight = 0;

    if (isReindexing) {
      // In reindexing mode, use strict phase boundaries from env vars with params as fallback
      startHeight = parseInt(process.env[`PHASE${version.phase}_START_HEIGHT`] || version.activation_height.toString());
      endHeight = version.phase === 1 ? 
        parseInt(process.env.PHASE1_TIMEOUT_HEIGHT || version.cap_height?.toString() || version.activation_height.toString()) :
        parseInt(process.env[`PHASE${version.phase}_END_HEIGHT`] || version.cap_height?.toString() || version.activation_height.toString());
    } else {
      // In continuous mode, use phase boundaries that connect without gaps
      // Use env vars if specified, otherwise fall back to global-params.json values
      if (version.phase === 1) {
        startHeight = parseInt(process.env.PHASE1_START_HEIGHT || phase1Version.activation_height.toString());
        endHeight = parseInt(process.env.PHASE2_START_HEIGHT || phase2Version.activation_height.toString()) - 1;
      } else if (version.phase === 2) {
        startHeight = parseInt(process.env.PHASE2_START_HEIGHT || phase2Version.activation_height.toString());
        endHeight = parseInt(process.env.PHASE3_START_HEIGHT || phase3Version.activation_height.toString()) - 1;
      } else if (version.phase === 3) {
        startHeight = parseInt(process.env.PHASE3_START_HEIGHT || phase3Version.activation_height.toString());
        endHeight = parseInt(process.env.PHASE3_END_HEIGHT || phase3Version.cap_height?.toString() || phase3Version.activation_height.toString());
      }
    }
    
    // Skip if height is outside the valid range
    if (startHeight === 0 || endHeight === 0) {
      logger.error(`Invalid height range for phase ${version.phase}: ${startHeight} - ${endHeight}`);
      continue;
    }

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

export async function getParamsForHeight(height: number): Promise<any | null> {
  try {
    const params = await loadParams();
    const dbInstance = Database.getInstance();
    const isReindexing = process.env.INDEX_SPECIFIC_PHASE === 'true';
    
    const applicableVersion = await findApplicableVersion(height, params.versions, dbInstance);

    if (!applicableVersion) {
      logger.info(`No applicable version found for height ${height}`);
      return null;
    }

    // For Phase 1, check target stake only if not reindexing
    if (applicableVersion.phase === 1 && !isReindexing) {
      const stats = await dbInstance.getGlobalStats();
      const totalStake = stats.totalStakeBTC * 100000000;
      const isPhase1Complete = await checkPhase1End(totalStake);
      
      if (isPhase1Complete) {
        logger.info(`Phase 1 completed at height ${height} due to reaching target stake`);
        return null;
      }
    }

    return {
      ...applicableVersion,
      // Use the exact activation height from the version
      activation_height: applicableVersion.activation_height
    };
  } catch (error) {
    logger.error('Error getting parameters for height:', error);
    return null;
  }
}