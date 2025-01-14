import findStakingAmount from './findStakingAmount.js';

import { BitcoinTransaction } from '../../utils/stake-validator.js';
import { VersionParams } from '../../utils/params-validator.js';

const phaseRanges = {
  1: {
    start: parseInt(process.env.PHASE1_START_HEIGHT || '857910'),
    end: parseInt(process.env.PHASE1_END_HEIGHT || '864789')
  },
  2: {
    start: parseInt(process.env.PHASE2_START_HEIGHT || '864790'),
    end: parseInt(process.env.PHASE2_END_HEIGHT || '875087')
  },
  3: {
    start: parseInt(process.env.PHASE3_START_HEIGHT || '875088'),
    end: parseInt(process.env.PHASE3_END_HEIGHT || '885385')
  }
};

export default (
  blockHeight: number,
  tx: BitcoinTransaction,
  params: VersionParams
): { phase: number; isOverflow: boolean, shouldProcess: boolean } => {
  let phase: number | undefined;

  for (const [key, value] of Object.entries(phaseRanges)) {
    if (blockHeight >= value.start && blockHeight <= value.end) {
      phase = parseInt(key);
      break;
    }
  }

  const indexSpecificPhase = process.env.INDEX_SPECIFIC_PHASE === 'true';
  const targetPhase = parseInt(process.env.PHASE_TO_INDEX || '1');
  const shouldProcess = !indexSpecificPhase || phase === targetPhase;

  if (!shouldProcess)
    return { phase: phase ?? 0, isOverflow: false, shouldProcess: false };

  let isOverflow = false;

  switch (phase) {
    case 1: {
      if (params.staking_cap !== undefined) {
        const stakingCapSats = BigInt(Math.floor(params.staking_cap));
        const currentStakeSats = BigInt(Math.floor(findStakingAmount(tx)));
        isOverflow = currentStakeSats > stakingCapSats;
      }
      break;
    }
    case 2:
    case 3: {
      const range = phaseRanges[phase];
      isOverflow = blockHeight < range.start || blockHeight > range.end;
      break;
    }

    default:
      isOverflow = true;
  }

  return { phase: phase ?? 0, isOverflow, shouldProcess };
}