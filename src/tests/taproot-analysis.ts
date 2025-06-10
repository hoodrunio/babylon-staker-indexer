import { BitcoinRPC } from '../utils/bitcoin-rpc';
import { parseOpReturn } from '../utils/op-return-parser';
import * as dotenv from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

const TEST_TXIDS = [
  'f20d49031e1766b4ad4a7b772044ccd25ad92832b0b912e059052871db803701',
  '42cf7e8c57393320821a5248938ecbb367f3ff17db2b54d5ab1ec04925ffad01',
  'fcb49d1c065d1d5f52bbd7b882080376a6c9f05005b4641a769e974f5188260c',
  '357437b294731ffcd42515c8a54b49cfa57ae6aebaf81259ee1cc1f17e7ce610'
];

interface TaprootOutput {
  value: number;
  address: string;
  scriptPubKey: {
    hex: string;
    type: string;
    address: string;
  };
}

interface StakingData {
  version: number;
  staker_public_key: string;
  finality_provider: string;
  staking_time: number;
}

interface Transaction {
  txid: string;
  vout: TaprootOutput[];
}

/* interface OpReturnOutput {
  scriptPubKey: {
    hex: string;
    type: string;
    asm: string;
  };
}
*/
interface BabylonStakingTx {
  output_index: number;
  start_height: number;
  start_timestamp: string;
  timelock: number;
  tx_hex: string;
}

interface BabylonAPIResponse {
  data: {
    finality_provider_pk_hex: string;
    is_overflow: boolean;
    staker_pk_hex: string;
    staking_tx: BabylonStakingTx;
    staking_tx_hash_hex: string;
    staking_value: number;
    state: string;
    unbonding_tx?: BabylonStakingTx;
  };
  pagination: {
    next_key: string;
  };
}

function satoshiToBtc(satoshi: number): number {
  return satoshi / 100000000;
}

async function validateWithBabylonAPI(txid: string): Promise<BabylonAPIResponse['data'] | null> {
  try {
    const response = await fetch(`https://staking-api.babylonlabs.io/v1/delegation?staking_tx_hash_hex=${txid}`);
    if (!response.ok) {
      logger.info('No staking data found in Babylon API');
      return null;
    }
    const data = await response.json() as BabylonAPIResponse;
    return data.data;
  } catch (error) {
    logger.error('Error fetching from Babylon API:', error);
    return null;
  }
}

async function analyzeTaprootTransaction(txid: string) {
  const rpc = new BitcoinRPC(process.env.BTC_RPC_URL!);
  
  try {
    logger.info(`\n=== Analyzing transaction: ${txid} ===`);
    const tx = await rpc.call('getrawtransaction', [txid, true]) as Transaction;
    
    // Validate against Babylon API
    const babylonData = await validateWithBabylonAPI(txid);
    if (babylonData) {
      logger.info('\nBabylon API Data:', {
        staking_value: `${babylonData.staking_value} satoshis (${satoshiToBtc(babylonData.staking_value)} BTC)`,
        output_index: babylonData.staking_tx.output_index,
        staker_pk: babylonData.staker_pk_hex,
        fp_pk: babylonData.finality_provider_pk_hex,
        state: babylonData.state
      });
    }
    
    // 1. Find and validate OP_RETURN data
    const opReturnOutput = tx.vout.find((out: any) => out.scriptPubKey.type === 'nulldata');
    if (!opReturnOutput) {
      logger.info('No OP_RETURN output found');
      return;
    }

    const opReturnData = parseOpReturn(opReturnOutput.scriptPubKey.hex);
    if (!opReturnData) {
      logger.info('Invalid OP_RETURN data');
      return;
    }

    logger.info('\nOP_RETURN Data:', {
      version: opReturnData.version,
      staker_pk: opReturnData.staker_public_key,
      finality_provider: opReturnData.finality_provider,
      staking_time: opReturnData.staking_time
    });

    // 2. Find all Taproot outputs
    const taprootOutputs = tx.vout.filter((out: any) => 
      out.scriptPubKey.type === 'witness_v1_taproot'
    );

    logger.info(`\nFound ${taprootOutputs.length} Taproot outputs`);

    // 3. Analyze each Taproot output
    for (const [index, output] of taprootOutputs.entries()) {
      logger.info(`\nAnalyzing Taproot output ${index}:`, {
        value: output.value,
        address: output.scriptPubKey.address
      });

      const isStakingOutput = await analyzeTaprootOutput(output, opReturnData, tx, babylonData, index);
      
      if (isStakingOutput) {
        logger.info('✅ This is the staking output');
        logger.info('Staking amount:', output.value, 'BTC');
        
        if (babylonData) {
          const expectedBtc = satoshiToBtc(babylonData.staking_value);
          const valueDiff = Math.abs(output.value - expectedBtc);
          const isCorrectValue = valueDiff < 0.00000001; // Account for floating point precision
          const isCorrectIndex = index === babylonData.staking_tx.output_index;
          
          logger.info(isCorrectValue 
            ? '✅ Matches Babylon API data (value)'
            : '❌ Does not match Babylon API data (value)');
          logger.info(isCorrectIndex 
            ? '✅ Matches Babylon API data (index)'
            : '❌ Does not match Babylon API data (index)');
        }
      } else {
        logger.info('❌ This is not the staking output');
      }
    }

  } catch (error) {
    logger.error(`Error analyzing transaction ${txid}:`, error);
  }
}

async function analyzeTaprootOutput(
  output: TaprootOutput, 
  stakingData: StakingData, 
  tx: Transaction,
  babylonData: BabylonAPIResponse['data'] | null,
  outputIndex: number
): Promise<boolean> {
  try {
    // 1. Verify witness version (must be 1 for Taproot)
    const witnessVersion = output.scriptPubKey.hex.slice(0, 2);
    if (witnessVersion !== '51') { // 0x51 = OP_1 = witness v1
      logger.info('Invalid witness version');
      return false;
    }

    // 2. Extract output key (32 bytes after witness version)
    const outputKey = output.scriptPubKey.hex.slice(2);
    logger.info('\nOutput Key Analysis:');
    logger.info('Raw Output Key:', outputKey);
    logger.info('Expected components:');
    logger.info('- Staker PK:', stakingData.staker_public_key);
    logger.info('- FP Key:', stakingData.finality_provider);
    logger.info('- Staking Time:', stakingData.staking_time);
    
    // 3. Basic validation
    const DUST_AMOUNT = 0.0001; // 10000 satoshis
    if (output.value <= DUST_AMOUNT) {
      logger.info('Output value too small, likely dust');
      return false;
    }

    // 4. If we have Babylon API data, use it as source of truth
    if (babylonData) {
      const expectedBtc = satoshiToBtc(babylonData.staking_value);
      const valueDiff = Math.abs(output.value - expectedBtc);
      const isCorrectValue = valueDiff < 0.00000001; // Account for floating point precision
      const isCorrectIndex = outputIndex === babylonData.staking_tx.output_index;
      
      if (!isCorrectValue) {
        logger.info(`Value mismatch: expected ${expectedBtc} BTC, got ${output.value} BTC`);
      }
      if (!isCorrectIndex) {
        logger.info(`Index mismatch: expected output ${babylonData.staking_tx.output_index}, got ${outputIndex}`);
      }
      
      return isCorrectValue && isCorrectIndex;
    }
    
    // 5. Fallback to basic validation if no API data
    const taprootOutputs = tx.vout.filter((out: any) => 
      out.scriptPubKey.type === 'witness_v1_taproot'
    );
    
    // Check if this output matches the expected staking pattern
    logger.info('\nStaking pattern analysis:');
    logger.info('- Has valid witness version (v1)');
    logger.info('- Above dust threshold');
    logger.info(`- One of ${taprootOutputs.length} Taproot outputs`);
    logger.info('- OP_RETURN data matches staking format');
    
    return true;
  } catch (error) {
    logger.error('Error in Taproot analysis:', error);
    return false;
  }
}

// Singleton RPC instance
/* let rpcInstance: BitcoinRPC | null = null;
function getRPC(): BitcoinRPC {
  if (!rpcInstance) {
    rpcInstance = new BitcoinRPC(process.env.BTC_RPC_URL!);
  }
  return rpcInstance;
} */

/* async function main() {
  logger.info('Starting Taproot transaction analysis...');
  logger.info('Bitcoin RPC URL:', process.env.BTC_RPC_URL);
  
  for (const txid of TEST_TXIDS) {
    await analyzeTaprootTransaction(txid);
  }
} */
/* async function analyzeStakingUnbondingPair(stakingTxHash: string, unbondingTxHash: string) {
  const rpc = getRPC();
  
  try {
    logger.info('\n=== Staking & Unbonding Transaction Analysis ===');
    
    // 1. Analyze Staking Transaction
    logger.info('\n1. Staking Transaction Analysis:', stakingTxHash);
    const stakingTx = await rpc.call('getrawtransaction', [stakingTxHash, true]);
    
    // Find and parse OP_RETURN output
    const opReturnOutput = stakingTx.vout.find((out: any) => out.scriptPubKey.type === 'nulldata');
    const opReturnData = opReturnOutput ? parseOpReturn(opReturnOutput.scriptPubKey.hex) : null;
    
    // Find Taproot outputs
    const taprootOutputs = stakingTx.vout.filter((out: any) => out.scriptPubKey.type === 'witness_v1_taproot');
    
    logger.info('\nStaking TX Details:');
    logger.info('- Total outputs:', stakingTx.vout.length);
    logger.info('- Taproot outputs:', taprootOutputs.length);
    logger.info('- Has OP_RETURN:', !!opReturnOutput);
    
    // Show each output in detail
    stakingTx.vout.forEach((out: any, index: number) => {
      logger.info(`\nOutput #${index}:`);
      logger.info('- Type:', out.scriptPubKey.type);
      logger.info('- Value:', out.value, 'BTC');
      if (out.scriptPubKey.type === 'witness_v1_taproot') {
        logger.info('- Taproot Address:', out.scriptPubKey.address);
      }
    });

    // 2. Analyze Unbonding Transaction
    logger.info('\n2. Unbonding Transaction Analysis:', unbondingTxHash);
    const unbondingTx = await rpc.call('getrawtransaction', [unbondingTxHash, true]);
    
    logger.info('\nUnbonding TX Details:');
    logger.info('- Input count:', unbondingTx.vin.length);
    logger.info('- Output count:', unbondingTx.vout.length);
    
    // Input analysis
    for (const [index, input] of unbondingTx.vin.entries()) {
      logger.info(`\nInput #${index}:`);
      logger.info('- Previous TX:', input.txid);
      logger.info('- Previous Output Index:', input.vout);
      
      // Check the transaction referenced by the input
      const prevTx = await rpc.call('getrawtransaction', [input.txid, true]);
      const referencedOutput = prevTx.vout[input.vout];
      
      logger.info('\nReferenced Output Details:');
      logger.info('- Type:', referencedOutput.scriptPubKey.type);
      logger.info('- Value:', referencedOutput.value, 'BTC');
      
      // If it refers to the staking tx
      if (input.txid === stakingTxHash) {
        logger.info('\n🔍 STAKING CONNECTION FOUND!');
        logger.info(`This unbonding transaction spends output #${input.vout} of the staking transaction`);
        
        // Verify with Babylon API
        const babylonData = await validateWithBabylonAPI(stakingTxHash);
        if (babylonData) {
          logger.info('\nBabylon API Validation:');
          logger.info('Expected staking output index:', babylonData.staking_tx.output_index);
          logger.info('Actual referenced output index:', input.vout);
          logger.info(babylonData.staking_tx.output_index === input.vout 
            ? '✅ Output index matches Babylon API'
            : '❌ Output index does not match Babylon API');
        }
      }
    }
    
    // Output analysis
    unbondingTx.vout.forEach((out: any, index: number) => {
      logger.info(`\nOutput #${index}:`);
      logger.info('- Type:', out.scriptPubKey.type);
      logger.info('- Value:', out.value, 'BTC');
      if (out.scriptPubKey.type === 'witness_v1_taproot') {
        logger.info('- Taproot Address:', out.scriptPubKey.address);
      }
    });

  } catch (error) {
    logger.error('Error in analysis:', error);
  }
}

// Add test transaction pairs
const TEST_PAIRS = [
  {
    staking: '919188ba1625f49a4304780c5ab0e557cbbb75ffc7ad237cc5743724f7524e56',
    unbonding: 'a20f213e54962d4567117790eaf8d110c534a0e8ef0c1fbfd741ba2c3b27bdff'
  }
]; */

// Update main function
async function main() {
  logger.info('Starting Taproot transaction analysis...');
  
  // Analyze existing test transactions
  for (const txid of TEST_TXIDS) {
    await analyzeTaprootTransaction(txid);
  }
  
  // Analyze Staking-Unbonding pairs
 /*  for (const pair of TEST_PAIRS) {
    await analyzeStakingUnbondingPair(pair.staking, pair.unbonding);
  } */
}

// Run analysis
main().catch(logger.error);
