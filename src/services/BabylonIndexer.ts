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
    this.db = new Database();
  }

  async scanBlocks(startHeight: number, endHeight: number): Promise<void> {
    try {
      const lastProcessed = await this.db.getLastProcessedBlock();
      const actualStartHeight = Math.max(startHeight, lastProcessed + 1);

      console.log(`Scanning blocks: ${actualStartHeight} - ${endHeight}`);
      let totalTransactions = 0;
      let babylonPrefix = 0;
      let validStakes = 0;
      let savedTransactions = 0;

      // Get phase configuration and helpers
      const { getPhaseForHeight, checkPhaseCondition, getPhaseConfig } = await import('../config/phase-config');
      const phaseConfig = getPhaseConfig();

      // Initialize phase stats for all phases that start within our scan range
      for (const phase of phaseConfig.phases) {
        if (phase.startHeight >= actualStartHeight && phase.startHeight <= endHeight) {
          try {
            await this.db.initPhaseStats(phase.phase, phase.startHeight);
            console.log(`Initialized stats for phase ${phase.phase} starting at height ${phase.startHeight}`);
          } catch (error) {
            console.error(`Error initializing phase ${phase.phase} stats:`, error);
          }
        }
      }

      // Also initialize stats for any active phase that started before our scan range
      const startPhase = getPhaseForHeight(actualStartHeight);
      if (startPhase && startPhase.startHeight < actualStartHeight) {
        try {
          await this.db.initPhaseStats(startPhase.phase, startPhase.startHeight);
          console.log(`Initialized stats for active phase ${startPhase.phase} that started at height ${startPhase.startHeight}`);
        } catch (error) {
          console.error(`Error initializing active phase ${startPhase.phase} stats:`, error);
        }
      }

      for (let height = actualStartHeight; height <= endHeight; height++) {
        try {
          const progress = ((height - actualStartHeight) / (endHeight - actualStartHeight)) * 100;
          
          // Get current phase
          const currentPhase = getPhaseForHeight(height);
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
          const phaseEnded = await checkPhaseCondition(currentPhase, height);
          if (phaseEnded) {
            console.log(`Phase ${currentPhase.phase} conditions have been met at height ${height}`);
            await this.db.completePhase(currentPhase.phase, height, 'target_reached');
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

      // Convert BTC to satoshi with high precision
      const stakeAmount = Math.round(stakeOutput.value * 100000000); // Use Math.round instead of Math.floor for better precision
      console.log(`\nAnalyzing transaction: ${tx.txid}`);
      console.log(`Stake amount: ${stakeAmount} satoshi (${stakeOutput.value} BTC)`);

      // Check for OP_RETURN
      const opReturn = tx.vout[1]?.scriptPubKey?.hex;
      if (!opReturn) continue;

      const parsed = parseOpReturn(opReturn);
      const hasBabylonPrefix = Boolean(parsed);
      
      if (!parsed) continue;

      // Get parameters for this height and version
      const params = await getParamsForHeight(block.height, parsed.version);
      if (!params) {
        console.log(`Skip: No parameters found for height ${block.height}`);
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      // Validate parameters
      if (parsed.version !== params.version) {
        console.log(`Skip: Version mismatch (tx: ${parsed.version}, params: ${params.version})`);
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      // Validate stake amount
      if (stakeAmount < params.min_staking_amount) {
        console.log(`Skip: Stake amount too low (${stakeAmount} < ${params.min_staking_amount})`);
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      if (stakeAmount > params.max_staking_amount) {
        console.log(`Skip: Stake amount too high (${stakeAmount} > ${params.max_staking_amount})`);
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      // Validate staking time
      if (parsed.staking_time < params.min_staking_time) {
        console.log(`Skip: Staking time too low`);
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      if (parsed.staking_time > params.max_staking_time) {
        console.log(`Skip: Staking time too high`);
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      // All validations passed
      console.log(`Transaction is valid Babylon stake!`);
      const stakeTransaction = this.createStakeTransaction(tx, parsed, block);
      transactions.push({
        ...stakeTransaction,
        isValid: true,
        hasBabylonPrefix
      });

/*    console.log(`\nStake transaction found: ${tx.txid}`);
      console.log(`Block: ${block.height}`);
      console.log(`Amount: ${(stakeAmount / 100000000).toFixed(8)} BTC`); */
    }

    return transactions;
  }

  private createStakeTransaction(
    tx: any, 
    parsed: any, 
    block: any
  ): StakeTransaction {
    return {
      txid: tx.txid,
      blockHeight: block.height,
      timestamp: block.time,
      stakeAmount: Math.floor(tx.vout[0].value * 100000000),
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