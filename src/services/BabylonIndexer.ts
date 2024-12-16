import { StakeTransaction, FinalityProviderStats, StakerStats, VersionStats, TimeRange, TopFinalityProviderStats } from '../types';
import { BitcoinRPC } from '../utils/bitcoin-rpc';
import { Database } from '../database';
import { parseOpReturn } from '../utils/op-return-parser';
import { getParamsForHeight } from '../utils/params-validator';

export class BabylonIndexer {
  private rpc: BitcoinRPC;
  public db: Database;

  constructor() {
    this.rpc = new BitcoinRPC(process.env.BTC_RPC_URL!);
    this.db = Database.getInstance();
    this.db.connect();
  }

  async scanBlocks(startHeight: number, endHeight: number): Promise<void> {
    try {
      const lastProcessed = await this.db.getLastProcessedBlock();
      let actualStartHeight = Math.max(startHeight, lastProcessed + 1);
      let actualEndHeight = endHeight;

      // Handle phase-specific indexing
      let targetPhase = null;
      if (process.env.INDEX_SPECIFIC_PHASE === 'true') {
        const phaseToIndex = parseInt(process.env.PHASE_TO_INDEX || '1');
        const phaseStartOverride = process.env.PHASE_START_OVERRIDE ? parseInt(process.env.PHASE_START_OVERRIDE) : null;
        const phaseEndOverride = process.env.PHASE_END_OVERRIDE ? parseInt(process.env.PHASE_END_OVERRIDE) : null;
        
        // Get phase configuration
        const { getPhaseConfig } = await import('../config/phase-config');
        const phaseConfig = getPhaseConfig();
        targetPhase = phaseConfig.phases.find(p => p.phase === phaseToIndex);
        
        if (!targetPhase) {
          throw new Error(`Phase ${phaseToIndex} not found in configuration`);
        }

        // Override start and end heights if specified
        actualStartHeight = phaseStartOverride || targetPhase.startHeight;
        
        if (phaseEndOverride) {
          actualEndHeight = phaseEndOverride;
        } else if (targetPhase.endCondition.type === 'block_height') {
          actualEndHeight = targetPhase.endCondition.value;
        } else if (targetPhase.timeoutHeight) {
          actualEndHeight = targetPhase.timeoutHeight;
        }

        // Validate block height range
        if (actualStartHeight < 800000 || actualEndHeight < 800000) {
          throw new Error(`Invalid block height range: ${actualStartHeight} - ${actualEndHeight}. Expected heights around 864xxx.`);
        }

        console.log(`Indexing Phase ${phaseToIndex} from block ${actualStartHeight} to ${actualEndHeight}`);
        
        // Initialize phase stats
        try {
          await this.db.initPhaseStats(targetPhase.phase, targetPhase.startHeight);
          console.log(`Initialized stats for phase ${targetPhase.phase}`);
        } catch (error) {
          console.error(`Error initializing phase ${targetPhase.phase} stats:`, error);
        }
      }

      console.log(`Scanning blocks: ${actualStartHeight} - ${actualEndHeight}`);
      let totalTransactions = 0;
      let babylonPrefix = 0;
      let validStakes = 0;
      let savedTransactions = 0;

      // Get phase configuration and helpers
      const { getPhaseForHeight, checkPhaseCondition, getPhaseConfig } = await import('../config/phase-config');
      const phaseConfig = getPhaseConfig();

      for (let height = actualStartHeight; height <= actualEndHeight; height++) {
        try {
          const progress = ((height - actualStartHeight) / (actualEndHeight - actualStartHeight)) * 100;
          
          // Get current phase
          const currentPhase = targetPhase || getPhaseForHeight(height);
          if (!currentPhase) {
            console.log(`No active phase for height ${height}, skipping...`);
            continue;
          }
          
          console.log(`Progress: ${progress.toFixed(1)}% | Block: ${height} | Phase: ${currentPhase.phase}`);

          const block = await this.rpc.getBlock(height);
          const transactions = await this.processBlock(block);
          
          totalTransactions += block.tx.length;
          babylonPrefix += transactions.filter(tx => tx.hasBabylonPrefix).length;
          validStakes += transactions.filter(tx => tx.isValid).length;

          // Save valid transactions and update phase stats
          for (const tx of transactions) {
            if (tx.isValid) {
              try {
                await this.db.saveTransaction(tx);
                await this.db.updatePhaseStats(currentPhase.phase, height, tx);
                savedTransactions++;
              } catch (error) {
                console.error(`Error saving transaction ${tx.txid}:`, error);
              }
            }
          }

          await this.db.updateLastProcessedBlock(height);
          console.log(`Block ${height} processed. Valid stakes in this block: ${transactions.filter(tx => tx.isValid).length}`);

          // Check if phase conditions are met
          if (!targetPhase) {  // Only check phase conditions if not in specific phase mode
            const phaseEnded = await checkPhaseCondition(currentPhase, height);
            if (phaseEnded) {
              console.log(`Phase ${currentPhase.phase} conditions have been met at height ${height}`);
              await this.db.completePhase(currentPhase.phase, height, 'target_reached');
            }
          }

        } catch (error) {
          console.error(`Error processing block ${height}:`, error);
          continue;
        }
      }

      console.log("\nScan Statistics:");
      console.log(`Total transactions: ${totalTransactions}`);
      console.log(`Babylon prefix found: ${babylonPrefix}`);
      console.log(`Valid stakes found: ${validStakes}`);
      console.log(`Successfully saved: ${savedTransactions}`);

    } catch (error) {
      console.error('Error in scanBlocks:', error);
      throw error;
    }
  }

  async processBlock(block: any): Promise<Array<StakeTransaction & {isValid: boolean, hasBabylonPrefix: boolean}>> {
    const transactions: Array<StakeTransaction & {isValid: boolean, hasBabylonPrefix: boolean}> = [];

    for (const tx of block.tx) {
      if (tx.vout.length !== 3) continue;

      // First output must be Taproot
      const stakeOutput = tx.vout[0];
      if (stakeOutput.scriptPubKey.type !== 'witness_v1_taproot') {
        continue;
      }

      // Store original BTC value and convert to satoshi only once
      const stakeAmountBTC = stakeOutput.value;
      const stakeAmountSatoshi = Math.round(stakeAmountBTC * 100000000);

      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`\nAnalyzing transaction: ${tx.txid}`);
        console.log(`Original stake amount: ${stakeAmountBTC} BTC`);
        console.log(`Converted to satoshi: ${stakeAmountSatoshi} satoshi`);
      }

      // Check for OP_RETURN
      const opReturn = tx.vout[1]?.scriptPubKey?.hex;
      if (!opReturn) continue;

      const parsed = parseOpReturn(opReturn);
      const hasBabylonPrefix = Boolean(parsed);
      
      if (!parsed) continue;

      // Get parameters for this height
      const params = await getParamsForHeight(block.height);
      if (!params) {
        console.log(`Skip: No parameters found for height ${block.height}`);
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      // Validate stake amount
      if (stakeAmountSatoshi < params.min_staking_amount) {
        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`Skip: Stake amount too low (${stakeAmountSatoshi} < ${params.min_staking_amount} satoshi)`);
        }
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      // Phase-specific max stake validation
      const maxStakeAmount = block.height >= 864790 
        ? 50000000000  // 500 BTC for Phase 2 and 3
        : params.max_staking_amount;  // Use version params for Phase 1

      if (stakeAmountSatoshi > maxStakeAmount) {
        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`Skip: Stake amount too high (${stakeAmountSatoshi} > ${maxStakeAmount} satoshi)`);
        }
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      // Validate staking time
      if (parsed.staking_time < params.min_staking_time) {
        console.log(`Skip: Staking time too low`);
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      if (parsed.staking_time > params.max_staking_time) {
        console.log(`Skip: Staking time too high`);
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      // All validations passed
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`Transaction is valid Babylon stake!`);
        console.log(`Final stake amount: ${stakeAmountSatoshi} satoshi (${stakeAmountBTC} BTC)`);
      }
      
      const stakeTransaction = this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi);
      transactions.push({
        ...stakeTransaction,
        isValid: true,
        hasBabylonPrefix
      });

/*    console.log(`\nStake transaction found: ${tx.txid}`);
      console.log(`Block: ${block.height}`);
      console.log(`Amount: ${(stakeAmountSatoshi / 100000000).toFixed(8)} BTC`); */
    }

    return transactions;
  }

  private createStakeTransaction(
    tx: any, 
    parsed: any, 
    block: any,
    stakeAmountSatoshi: number
  ): StakeTransaction {
    return {
      txid: tx.txid,
      blockHeight: block.height,
      timestamp: block.time,
      stakeAmount: stakeAmountSatoshi, // Use the pre-converted satoshi value
      stakerAddress: tx.vout[2].scriptPubKey.address,
      stakerPublicKey: parsed.staker_public_key,
      finalityProvider: parsed.finality_provider,
      stakingTime: parsed.staking_time,
      version: parsed.version,
      paramsVersion: parsed.version
    };
  }

  async getAllFinalityProviders(): Promise<FinalityProviderStats[]> {
    return this.db.getAllFPs();
  }

  async getTopFinalityProviders(limit: number = 10): Promise<TopFinalityProviderStats[]> {
    return this.db.getTopFPs(limit);
  }

  async getFinalityProviderStats(address: string, timeRange?: TimeRange): Promise<FinalityProviderStats> {
    return this.db.getFPStats(address, timeRange);
  }

  async getTopStakers(limit: number = 10): Promise<StakerStats[]> {
    return this.db.getTopStakers(limit);
  }

  async getStakerStats(address: string, timeRange?: TimeRange): Promise<StakerStats> {
    return this.db.getStakerStats(address, timeRange);
  }

  async getVersionStats(version: number, timeRange?: TimeRange): Promise<VersionStats> {
    return this.db.getVersionStats(version, timeRange);
  }

  async getGlobalStats() {
    return this.db.getGlobalStats();
  }
} 