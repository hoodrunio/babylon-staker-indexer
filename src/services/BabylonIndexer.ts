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
        
        const { getPhaseConfig } = await import('../config/phase-config');
        const phaseConfig = getPhaseConfig();
        targetPhase = phaseConfig.phases.find(p => p.phase === phaseToIndex);
        
        if (!targetPhase) {
          throw new Error(`Phase ${phaseToIndex} not found in configuration`);
        }

        actualStartHeight = phaseStartOverride || targetPhase.startHeight;
        
        if (phaseEndOverride) {
          actualEndHeight = phaseEndOverride;
        } else if (targetPhase.endCondition.type === 'block_height') {
          actualEndHeight = targetPhase.endCondition.value;
        } else if (targetPhase.timeoutHeight) {
          actualEndHeight = targetPhase.timeoutHeight;
        }

        if (actualStartHeight < 800000 || actualEndHeight < 800000) {
          throw new Error(`Invalid block height range: ${actualStartHeight} - ${actualEndHeight}. Expected heights around 864xxx.`);
        }

        console.log(`Indexing Phase ${phaseToIndex} from block ${actualStartHeight} to ${actualEndHeight}`);
        
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

      const { getPhaseForHeight, checkPhaseCondition, getPhaseConfig } = await import('../config/phase-config');
      const phaseConfig = getPhaseConfig();

      // Pre-load and cache parameters for the entire range
      const paramsCache = new Map<number, any>();
      for (let height = actualStartHeight; height <= actualEndHeight; height++) {
        const params = await getParamsForHeight(height);
        if (params) {
          paramsCache.set(height, params);
        }
      }

      // Process blocks in batches
      const BATCH_SIZE = 5; // Reduced from 10 to 5 to stay within rate limits
      for (let batchStart = actualStartHeight; batchStart <= actualEndHeight; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, actualEndHeight);
        const progress = ((batchStart - actualStartHeight) / (actualEndHeight - actualStartHeight)) * 100;
        console.log(`Progress: ${progress.toFixed(1)}% | Processing blocks ${batchStart} to ${batchEnd}`);

        try {
          // Fetch blocks in parallel with built-in rate limiting
          const blockPromises = [];
          for (let height = batchStart; height <= batchEnd; height++) {
            blockPromises.push(this.rpc.getBlock(height));
          }
          
          const blocks = await Promise.all(blockPromises);

          // Process blocks and collect transactions
          const batchTransactions: Array<StakeTransaction & { isValid: boolean; hasBabylonPrefix: boolean }> = [];
          const blockStats = new Map<number, { phase: number; validTxCount: number }>();

          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const height = batchStart + i;
            
            const currentPhase = targetPhase || getPhaseForHeight(height);
            if (!currentPhase) {
              console.log(`No active phase for height ${height}, skipping...`);
              continue;
            }

            // Get cached parameters
            const params = this.getParamsFromCache(height, paramsCache);
            const transactions = await this.processBlockWithParams(block, params);
            
            totalTransactions += block.tx.length;
            const validTxCount = transactions.filter(tx => tx.isValid).length;
            babylonPrefix += transactions.filter(tx => tx.hasBabylonPrefix).length;
            validStakes += validTxCount;

            blockStats.set(height, { phase: currentPhase.phase, validTxCount });
            batchTransactions.push(...transactions);
          }

          // Batch save transactions and update stats
          if (batchTransactions.length > 0) {
            const validTransactions = batchTransactions.filter(tx => tx.isValid);
            if (validTransactions.length > 0) {
              await this.db.saveTransactionBatch(validTransactions);
              savedTransactions += validTransactions.length;
            }
          }

          // Update block processing state and phase stats
          for (const [height, stats] of blockStats) {
            await this.db.updateLastProcessedBlock(height);
            if (stats.validTxCount > 0) {
              const transactions = batchTransactions.filter(tx => 
                tx.isValid && tx.blockHeight === height
              );
              await this.db.updatePhaseStatsBatch(stats.phase, height, transactions);
            }

            // Check phase conditions
            if (!targetPhase) {
              const currentPhase = getPhaseForHeight(height);
              if (currentPhase) {
                const phaseEnded = await checkPhaseCondition(currentPhase, height);
                if (phaseEnded) {
                  console.log(`Phase ${currentPhase.phase} conditions have been met at height ${height}`);
                }
              }
            }
          }

          // Add a small delay between batches to help prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Error processing batch ${batchStart}-${batchEnd}:`, error);
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

  private getParamsFromCache(height: number, paramsCache: Map<number, any>): any {
    return paramsCache.get(height);
  }

  private async processBlockWithParams(block: any, params: any): Promise<Array<StakeTransaction & {isValid: boolean, hasBabylonPrefix: boolean}>> {
    const transactions: Array<StakeTransaction & {isValid: boolean, hasBabylonPrefix: boolean}> = [];

    for (const tx of block.tx) {
      if (tx.vout.length !== 3) continue;

      const stakeOutput = tx.vout[0];
      if (stakeOutput.scriptPubKey.type !== 'witness_v1_taproot') {
        continue;
      }

      const stakeAmountBTC = stakeOutput.value;
      const stakeAmountSatoshi = Math.round(stakeAmountBTC * 100000000);

      const opReturn = tx.vout[1]?.scriptPubKey?.hex;
      if (!opReturn) continue;

      const parsed = parseOpReturn(opReturn);
      const hasBabylonPrefix = Boolean(parsed);
      
      if (!parsed) continue;

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
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      // Use the max_staking_amount from the current phase's parameters
      if (stakeAmountSatoshi > params.max_staking_amount) {
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      if (parsed.staking_time < params.min_staking_time || parsed.staking_time > params.max_staking_time) {
        transactions.push({
          ...this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi),
          isValid: false,
          hasBabylonPrefix
        });
        continue;
      }

      const stakeTransaction = this.createStakeTransaction(tx, parsed, block, stakeAmountSatoshi);
      transactions.push({
        ...stakeTransaction,
        isValid: true,
        hasBabylonPrefix
      });
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