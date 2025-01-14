import isTaprootOutput from './isTaprootOutput.js';

import { BitcoinTransaction } from '../../utils/stake-validator.js'

export default (tx: BitcoinTransaction): number => {
  const inputAddresses = tx.vin?.map((input: any) => {
    const scriptPubKey = input.prevout?.scriptPubKey || {};

    return scriptPubKey.address || null;
  }).filter(Boolean) || [];

  const stakingOutput = tx.vout?.find((output: any) => {
    return isTaprootOutput(output) && output.scriptPubKey?.type === 'witness_v1_taproot' && !inputAddresses.includes(output.scriptPubKey?.address);
  });

  return stakingOutput ? stakingOutput.value * 100000000 : 0;
}
