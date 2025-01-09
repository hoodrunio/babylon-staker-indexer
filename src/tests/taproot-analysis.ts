import { BitcoinRPC } from '../utils/bitcoin-rpc';
import { parseOpReturn } from '../utils/op-return-parser';
import * as dotenv from 'dotenv';

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

interface OpReturnOutput {
  scriptPubKey: {
    hex: string;
    type: string;
    asm: string;
  };
}

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
      console.log('No staking data found in Babylon API');
      return null;
    }
    const data = await response.json() as BabylonAPIResponse;
    return data.data;
  } catch (error) {
    console.error('Error fetching from Babylon API:', error);
    return null;
  }
}

async function analyzeTaprootTransaction(txid: string) {
  const rpc = new BitcoinRPC(process.env.BTC_RPC_URL!);
  
  try {
    console.log(`\n=== Analyzing transaction: ${txid} ===`);
    const tx = await rpc.call('getrawtransaction', [txid, true]) as Transaction;
    
    // Validate against Babylon API
    const babylonData = await validateWithBabylonAPI(txid);
    if (babylonData) {
      console.log('\nBabylon API Data:', {
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
      console.log('No OP_RETURN output found');
      return;
    }

    const opReturnData = parseOpReturn(opReturnOutput.scriptPubKey.hex);
    if (!opReturnData) {
      console.log('Invalid OP_RETURN data');
      return;
    }

    console.log('\nOP_RETURN Data:', {
      version: opReturnData.version,
      staker_pk: opReturnData.staker_public_key,
      finality_provider: opReturnData.finality_provider,
      staking_time: opReturnData.staking_time
    });

    // 2. Find all Taproot outputs
    const taprootOutputs = tx.vout.filter((out: any) => 
      out.scriptPubKey.type === 'witness_v1_taproot'
    );

    console.log(`\nFound ${taprootOutputs.length} Taproot outputs`);

    // 3. Analyze each Taproot output
    for (const [index, output] of taprootOutputs.entries()) {
      console.log(`\nAnalyzing Taproot output ${index}:`, {
        value: output.value,
        address: output.scriptPubKey.address
      });

      const isStakingOutput = await analyzeTaprootOutput(output, opReturnData, tx, babylonData, index);
      
      if (isStakingOutput) {
        console.log('✅ This is the staking output');
        console.log('Staking amount:', output.value, 'BTC');
        
        if (babylonData) {
          const expectedBtc = satoshiToBtc(babylonData.staking_value);
          const valueDiff = Math.abs(output.value - expectedBtc);
          const isCorrectValue = valueDiff < 0.00000001; // Account for floating point precision
          const isCorrectIndex = index === babylonData.staking_tx.output_index;
          
          console.log(isCorrectValue 
            ? '✅ Matches Babylon API data (value)'
            : '❌ Does not match Babylon API data (value)');
          console.log(isCorrectIndex 
            ? '✅ Matches Babylon API data (index)'
            : '❌ Does not match Babylon API data (index)');
        }
      } else {
        console.log('❌ This is not the staking output');
      }
    }

  } catch (error) {
    console.error(`Error analyzing transaction ${txid}:`, error);
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
      console.log('Invalid witness version');
      return false;
    }

    // 2. Extract output key (32 bytes after witness version)
    const outputKey = output.scriptPubKey.hex.slice(2);
    console.log('\nOutput Key Analysis:');
    console.log('Raw Output Key:', outputKey);
    console.log('Expected components:');
    console.log('- Staker PK:', stakingData.staker_public_key);
    console.log('- FP Key:', stakingData.finality_provider);
    console.log('- Staking Time:', stakingData.staking_time);
    
    // 3. Basic validation
    const DUST_AMOUNT = 0.0001; // 10000 satoshis
    if (output.value <= DUST_AMOUNT) {
      console.log('Output value too small, likely dust');
      return false;
    }

    // 4. If we have Babylon API data, use it as source of truth
    if (babylonData) {
      const expectedBtc = satoshiToBtc(babylonData.staking_value);
      const valueDiff = Math.abs(output.value - expectedBtc);
      const isCorrectValue = valueDiff < 0.00000001; // Account for floating point precision
      const isCorrectIndex = outputIndex === babylonData.staking_tx.output_index;
      
      if (!isCorrectValue) {
        console.log(`Value mismatch: expected ${expectedBtc} BTC, got ${output.value} BTC`);
      }
      if (!isCorrectIndex) {
        console.log(`Index mismatch: expected output ${babylonData.staking_tx.output_index}, got ${outputIndex}`);
      }
      
      return isCorrectValue && isCorrectIndex;
    }
    
    // 5. Fallback to basic validation if no API data
    const taprootOutputs = tx.vout.filter((out: any) => 
      out.scriptPubKey.type === 'witness_v1_taproot'
    );
    
    // Check if this output matches the expected staking pattern
    console.log('\nStaking pattern analysis:');
    console.log('- Has valid witness version (v1)');
    console.log('- Above dust threshold');
    console.log(`- One of ${taprootOutputs.length} Taproot outputs`);
    console.log('- OP_RETURN data matches staking format');
    
    return true;
  } catch (error) {
    console.error('Error in Taproot analysis:', error);
    return false;
  }
}

// Singleton RPC instance
let rpcInstance: BitcoinRPC | null = null;
function getRPC(): BitcoinRPC {
  if (!rpcInstance) {
    rpcInstance = new BitcoinRPC(process.env.BTC_RPC_URL!);
  }
  return rpcInstance;
}

/* async function main() {
  console.log('Starting Taproot transaction analysis...');
  console.log('Bitcoin RPC URL:', process.env.BTC_RPC_URL);
  
  for (const txid of TEST_TXIDS) {
    await analyzeTaprootTransaction(txid);
  }
} */
/* async function analyzeStakingUnbondingPair(stakingTxHash: string, unbondingTxHash: string) {
  const rpc = getRPC();
  
  try {
    console.log('\n=== Staking & Unbonding Transaction Analysis ===');
    
    // 1. Staking Transaction'ı analiz et
    console.log('\n1. Staking Transaction Analysis:', stakingTxHash);
    const stakingTx = await rpc.call('getrawtransaction', [stakingTxHash, true]);
    
    // OP_RETURN çıktısını bul ve parse et
    const opReturnOutput = stakingTx.vout.find((out: any) => out.scriptPubKey.type === 'nulldata');
    const opReturnData = opReturnOutput ? parseOpReturn(opReturnOutput.scriptPubKey.hex) : null;
    
    // Taproot çıktılarını bul
    const taprootOutputs = stakingTx.vout.filter((out: any) => out.scriptPubKey.type === 'witness_v1_taproot');
    
    console.log('\nStaking TX Details:');
    console.log('- Total outputs:', stakingTx.vout.length);
    console.log('- Taproot outputs:', taprootOutputs.length);
    console.log('- Has OP_RETURN:', !!opReturnOutput);
    
    // Her bir output'u detaylı göster
    stakingTx.vout.forEach((out: any, index: number) => {
      console.log(`\nOutput #${index}:`);
      console.log('- Type:', out.scriptPubKey.type);
      console.log('- Value:', out.value, 'BTC');
      if (out.scriptPubKey.type === 'witness_v1_taproot') {
        console.log('- Taproot Address:', out.scriptPubKey.address);
      }
    });

    // 2. Unbonding Transaction'ı analiz et
    console.log('\n2. Unbonding Transaction Analysis:', unbondingTxHash);
    const unbondingTx = await rpc.call('getrawtransaction', [unbondingTxHash, true]);
    
    console.log('\nUnbonding TX Details:');
    console.log('- Input count:', unbondingTx.vin.length);
    console.log('- Output count:', unbondingTx.vout.length);
    
    // Input analizi
    for (const [index, input] of unbondingTx.vin.entries()) {
      console.log(`\nInput #${index}:`);
      console.log('- Previous TX:', input.txid);
      console.log('- Previous Output Index:', input.vout);
      
      // Input'un referans verdiği transaction'ı kontrol et
      const prevTx = await rpc.call('getrawtransaction', [input.txid, true]);
      const referencedOutput = prevTx.vout[input.vout];
      
      console.log('\nReferenced Output Details:');
      console.log('- Type:', referencedOutput.scriptPubKey.type);
      console.log('- Value:', referencedOutput.value, 'BTC');
      
      // Eğer staking tx'e referans veriyorsa
      if (input.txid === stakingTxHash) {
        console.log('\n🔍 STAKING CONNECTION FOUND!');
        console.log(`This unbonding transaction spends output #${input.vout} of the staking transaction`);
        
        // Babylon API ile doğrula
        const babylonData = await validateWithBabylonAPI(stakingTxHash);
        if (babylonData) {
          console.log('\nBabylon API Validation:');
          console.log('Expected staking output index:', babylonData.staking_tx.output_index);
          console.log('Actual referenced output index:', input.vout);
          console.log(babylonData.staking_tx.output_index === input.vout 
            ? '✅ Output index matches Babylon API'
            : '❌ Output index does not match Babylon API');
        }
      }
    }
    
    // Output analizi
    unbondingTx.vout.forEach((out: any, index: number) => {
      console.log(`\nOutput #${index}:`);
      console.log('- Type:', out.scriptPubKey.type);
      console.log('- Value:', out.value, 'BTC');
      if (out.scriptPubKey.type === 'witness_v1_taproot') {
        console.log('- Taproot Address:', out.scriptPubKey.address);
      }
    });

  } catch (error) {
    console.error('Error in analysis:', error);
  }
}

// Test transaction çiftlerini ekle
const TEST_PAIRS = [
  {
    staking: '919188ba1625f49a4304780c5ab0e557cbbb75ffc7ad237cc5743724f7524e56',
    unbonding: 'a20f213e54962d4567117790eaf8d110c534a0e8ef0c1fbfd741ba2c3b27bdff'
  }
]; */

// Main fonksiyonunu güncelle
async function main() {
  console.log('Starting Taproot transaction analysis...');
  
  // Mevcut test transaction'ları analiz et
  for (const txid of TEST_TXIDS) {
    await analyzeTaprootTransaction(txid);
  }
  
  // Staking-Unbonding çiftlerini analiz et
 /*  for (const pair of TEST_PAIRS) {
    await analyzeStakingUnbondingPair(pair.staking, pair.unbonding);
  } */
}

// Run analysis
main().catch(console.error);
