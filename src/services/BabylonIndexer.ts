import { StakeTransaction, FinalityProviderStats, StakerStats, VersionStats, TimeRange, TopFinalityProviderStats, FinalityProvider } from '../types';
import { BitcoinRPC } from '../utils/bitcoin-rpc';
import { Database } from '../database';
import { parseOpReturn } from '../utils/op-return-parser';
import { getParamsForHeight } from '../utils/params-validator';
import { validateStakeTransaction } from '../utils/stake-validator';

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
      const isReindexing = process.env.INDEX_SPECIFIC_PHASE === 'true';
      let targetPhase = null;
      if (isReindexing) {
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

      // Initialize stats for all phases if not reindexing
      if (!isReindexing) {
        for (const phase of phaseConfig.phases) {
          try {
            await this.db.initPhaseStats(phase.phase, phase.startHeight);
            console.log(`Initialized stats for phase ${phase.phase}`);
          } catch (error) {
            console.error(`Error initializing phase ${phase.phase} stats:`, error);
          }
        }
      }

      // Pre-load and cache parameters for the entire range
      const paramsCache = new Map<number, any>();
      
      // Process blocks in batches
      const BATCH_SIZE = 5;
      let currentHeight = actualStartHeight;
      let currentPhaseNumber = 0;
      
      while (currentHeight <= actualEndHeight) {
        const batchEnd = Math.min(currentHeight + BATCH_SIZE - 1, actualEndHeight);
        const progress = ((currentHeight - actualStartHeight) / (actualEndHeight - actualStartHeight)) * 100;
        console.log(`Progress: ${progress.toFixed(1)}% | Processing blocks ${currentHeight} to ${batchEnd}`);

        try {
          // Get the current phase
          const currentPhase = targetPhase || getPhaseForHeight(currentHeight);
          if (!currentPhase) {
            console.log(`No active phase for height ${currentHeight}, skipping...`);
            
            // Find the next phase's start height
            const nextPhase = phaseConfig.phases.find(p => p.startHeight > currentHeight);
            if (nextPhase) {
              console.log(`Jumping to next phase (${nextPhase.phase}) at height ${nextPhase.startHeight}`);
              
              // Initialize stats for the next phase if it's different from the current one
              if (nextPhase.phase !== currentPhaseNumber) {
                try {
                  await this.db.initPhaseStats(nextPhase.phase, nextPhase.startHeight);
                  console.log(`Initialized stats for phase ${nextPhase.phase}`);
                  currentPhaseNumber = nextPhase.phase;
                } catch (error) {
                  console.error(`Error initializing phase ${nextPhase.phase} stats:`, error);
                }
              }
              
              currentHeight = nextPhase.startHeight;
              continue;
            } else {
              console.log('No more phases to process');
              break;
            }
          }

          // Update current phase number if it changed
          if (currentPhase.phase !== currentPhaseNumber) {
            try {
              await this.db.initPhaseStats(currentPhase.phase, currentPhase.startHeight);
              console.log(`Initialized stats for phase ${currentPhase.phase}`);
              currentPhaseNumber = currentPhase.phase;
            } catch (error) {
              console.error(`Error initializing phase ${currentPhase.phase} stats:`, error);
            }
          }

          // Load parameters for the batch
          for (let height = currentHeight; height <= batchEnd; height++) {
            const params = await getParamsForHeight(height);
            if (params) {
              paramsCache.set(height, params);
            }
          }

          // Fetch blocks in parallel with built-in rate limiting
          const blockPromises = [];
          for (let height = currentHeight; height <= batchEnd; height++) {
            blockPromises.push(this.rpc.getBlock(height));
          }
          
          const blocks = await Promise.all(blockPromises);

          // Process blocks and collect transactions
          const batchTransactions: Array<StakeTransaction & {isValid: boolean, hasBabylonPrefix: boolean}> = [];
          const blockStats = new Map<number, { phase: number; validTxCount: number }>();

          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const height = currentHeight + i;
            
            // Get cached parameters
            const params = this.getParamsFromCache(height, paramsCache);
            const transactions = await this.processBlockWithParams(block, params);
            
            totalTransactions += block.tx.length;
            const validTxCount = transactions.filter(tx => tx.isValid).length;
            babylonPrefix += transactions.filter(tx => tx.hasBabylonPrefix).length;
            validStakes += validTxCount;

            blockStats.set(height, { phase: currentPhase.phase, validTxCount });
            batchTransactions.push(...transactions);

            // Check if phase conditions are met
            if (!isReindexing && await checkPhaseCondition(currentPhase, height)) {
              console.log(`Phase ${currentPhase.phase} conditions have been met at height ${height}`);
              
              // Find the next phase's start height
              const nextPhase = phaseConfig.phases.find(p => p.startHeight > height);
              if (nextPhase) {
                console.log(`Jumping to next phase (${nextPhase.phase}) at height ${nextPhase.startHeight}`);
                
                // Initialize stats for the next phase
                try {
                  await this.db.initPhaseStats(nextPhase.phase, nextPhase.startHeight);
                  console.log(`Initialized stats for phase ${nextPhase.phase}`);
                  currentPhaseNumber = nextPhase.phase;
                } catch (error) {
                  console.error(`Error initializing phase ${nextPhase.phase} stats:`, error);
                }
                
                currentHeight = nextPhase.startHeight - 1; // -1 because we'll increment at the end of the loop
                break;
              }
            }
          }

          // Batch save transactions and update stats
          if (batchTransactions.length > 0) {
            const validTransactions = batchTransactions.filter(tx => tx.isValid);
            if (validTransactions.length > 0) {
              await this.db.saveTransactionBatch(validTransactions);
              savedTransactions += validTransactions.length;
            }

            // Update phase stats and last processed block
            for (const [height, stats] of blockStats) {
              if (stats.validTxCount > 0) {
                const heightTransactions = batchTransactions.filter(tx => 
                  tx.isValid && tx.blockHeight === height
                );
                await this.db.updatePhaseStatsBatch(stats.phase, height, heightTransactions);
              }
              await this.db.updateLastProcessedBlock(height);
            }
          }

          currentHeight = batchEnd + 1;
        } catch (error) {
          console.error(`Error processing blocks ${currentHeight}-${batchEnd}:`, error);
          currentHeight = batchEnd + 1;
        }
      }

      console.log('\nIndexing completed!');
      console.log(`Total transactions processed: ${totalTransactions}`);
      console.log(`Babylon prefix transactions: ${babylonPrefix}`);
      console.log(`Valid stakes: ${validStakes}`);
      console.log(`Saved transactions: ${savedTransactions}`);

    } catch (error) {
      console.error('Error scanning blocks:', error);
      throw error;
    }
  }

  private getParamsFromCache(height: number, paramsCache: Map<number, any>): any {
    return paramsCache.get(height);
  }

  private isTaprootOutput(output: any): boolean {
    // Handle both RPC format and our custom format
    const script = output.scriptPubKey?.hex;
    const type = output.scriptPubKey?.type;
    return (script && script.startsWith('5120') && script.length === 68) || // Raw script format
           (type === 'witness_v1_taproot'); // RPC format
  }

  private findStakingAmount(tx: any, validationResult: any): number {
    // Get input addresses from vin
    const inputAddresses = tx.vin?.map((input: any) => {
        // For RPC format, we need to look at the witness_v1_taproot address
        const scriptPubKey = input.prevout?.scriptPubKey || {};
        return scriptPubKey.address || null;
    }).filter(Boolean) || [];

    // Find Taproot output that goes to a new address
    const stakingOutput = tx.vout?.find((out: any) => 
      this.isTaprootOutput(out) && 
      out.scriptPubKey?.type === 'witness_v1_taproot' && 
      !inputAddresses.includes(out.scriptPubKey?.address)
    );

    return stakingOutput ? stakingOutput.value * 100000000 : 0; // Convert to satoshis
  }

  private async createStakeTransaction(
    tx: any,
    parsed: any,
    block: any,
    stakeAmountSatoshi: number,
    validationResult: any
  ): Promise<StakeTransaction | null> {
    // Get staker address from input - try different formats
    let stakerAddress: string | undefined;
    const firstInput = tx.vin?.[0];
    
    if (firstInput?.prevout?.scriptPubKey?.address) {
      // Full RPC format with prevout info
      stakerAddress = firstInput.prevout.scriptPubKey.address;
    } else if (firstInput?.address) {
      // Simplified format
      stakerAddress = firstInput.address;
    } else if (firstInput?.scriptPubKey?.address) {
      // Alternative format
      stakerAddress = firstInput.scriptPubKey.address;
    }

    if (!stakerAddress) {
      console.warn(`Warning: Could not find staker address for tx ${tx.txid}`);
      return null;
    }

    // Find Taproot output that goes to a new address (still needed for validation)
    const taprootOutput = tx.vout?.find((out: any) => 
      this.isTaprootOutput(out) && 
      out.scriptPubKey?.type === 'witness_v1_taproot' && 
      out.scriptPubKey?.address !== stakerAddress
    );
    
    if (!taprootOutput) {
      console.warn(`Warning: Could not find taproot output for tx ${tx.txid}`);
      return null;
    }
    
    // Get phase configuration for this block height
    const { getPhaseForHeight } = await import('../config/phase-config');
    const phase = getPhaseForHeight(block.height);
    
    if (!phase) {
      console.warn(`Warning: No valid phase found for block height ${block.height}`);
      return null;
    }
    
    return {
      txid: tx.txid,
      blockHeight: block.height,
      timestamp: block.time,
      stakeAmount: stakeAmountSatoshi,
      stakerAddress: stakerAddress,
      stakerPublicKey: parsed.staker_public_key,
      finalityProvider: parsed.finality_provider,
      stakingTime: parsed.staking_time,
      version: parsed.version,
      paramsVersion: phase.phase - 1, // Convert phase number (1,2,3) to paramsVersion (0,1,2)
      isOverflow: validationResult.isOverflow || false,
      overflowAmount: validationResult.overflowAmount || 0
    };
  }

  private determinePhaseAndOverflow(blockHeight: number, tx: any, params: any): { phase: number, isOverflow: boolean, shouldProcess: boolean } {
    // Phase ranges
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

    // Determine which phase this block belongs to
    let phase = 0;
    for (const [p, range] of Object.entries(phaseRanges)) {
      if (blockHeight >= range.start && blockHeight <= range.end) {
        phase = parseInt(p);
        break;
      }
    }

    // If we're in specific phase mode, check if we should process this transaction
    const indexSpecificPhase = process.env.INDEX_SPECIFIC_PHASE === 'true';
    const targetPhase = parseInt(process.env.PHASE_TO_INDEX || '1');
    
    // In specific phase mode, only process transactions for the target phase
    const shouldProcess = !indexSpecificPhase || phase === targetPhase;
    if (!shouldProcess) {
      return { phase, isOverflow: false, shouldProcess: false };
    }

    // Determine if transaction is overflow based on phase-specific rules
    let isOverflow = false;

    switch (phase) {
      case 1:
        // Phase 1: Check against staking cap
        if (params.staking_cap !== undefined) {
          const stakingCapSats = BigInt(Math.floor(params.staking_cap));
          const currentStakeSats = BigInt(Math.floor(this.findStakingAmount(tx, { isValid: true })));
          isOverflow = currentStakeSats > stakingCapSats;
        }
        break;

      case 2:
      case 3:
        // Phase 2 & 3: Transaction is overflow if outside valid block height range
        const range = phaseRanges[phase];
        isOverflow = blockHeight < range.start || blockHeight > range.end;
        break;

      default:
        // If block is not in any phase range, mark as overflow
        isOverflow = true;
    }

    return { phase, isOverflow, shouldProcess: true };
  }

  private async processBlockWithParams(block: any, params: any): Promise<Array<StakeTransaction & {isValid: boolean, hasBabylonPrefix: boolean}>> {
    const transactions: Array<StakeTransaction & {isValid: boolean, hasBabylonPrefix: boolean}> = [];
    const validTransactions: Array<{tx: any, amount: number, timestamp: number}> = [];

    // First pass: Collect all valid transactions with their timestamps
    for (const tx of block.tx) {
      if (!params) {
        console.log(`Skip: No parameters found for height ${block.height}`);
        continue;
      }

      // Basic validation without overflow check
      const validationResult = await validateStakeTransaction(tx, params, block.height, 0);
      
      if (!validationResult.hasBabylonPrefix) continue;

      // Skip invalid transactions
      if (!validationResult.isValid) {
        transactions.push({
          txid: tx.txid,
          blockHeight: block.height,
          timestamp: block.time,
          stakeAmount: 0,
          stakerAddress: '',
          stakerPublicKey: '',
          finalityProvider: '',
          stakingTime: 0,
          version: 0,
          paramsVersion: 0,
          isOverflow: false,
          overflowAmount: 0,
          isValid: false,
          hasBabylonPrefix: true
        });
        continue;
      }

      const stakeAmountSatoshi = this.findStakingAmount(tx, validationResult);
      validTransactions.push({ tx, amount: stakeAmountSatoshi, timestamp: block.time });
    }

    // Sort by timestamp and amount (highest first) within the same block
    validTransactions.sort((a, b) => {
      if (a.timestamp === b.timestamp) {
        return b.amount - a.amount;
      }
      return a.timestamp - b.timestamp;
    });

    // Second pass: Process transactions with proper overflow checking
    let currentActiveStake = 0;
    for (const { tx, amount } of validTransactions) {
      // Determine phase and overflow status first
      const { phase, isOverflow } = this.determinePhaseAndOverflow(block.height, tx, params);
      
      // For phase 1, we need to track active stake for overflow
      // For other phases, we only care about block height range
      const effectiveActiveStake = phase === 1 ? currentActiveStake : 0;
      
      // Re-validate with current active stake (only matters for phase 1)
      const validationResult = await validateStakeTransaction(tx, params, block.height, effectiveActiveStake);
      
      // Parse OP_RETURN data
      const opReturnOutput = tx.vout?.find((out: any) => 
        out.scriptPubKey?.type === 'nulldata' || 
        (out.scriptPubKey?.hex && out.scriptPubKey.hex.startsWith('6a'))
      );

      if (!opReturnOutput?.scriptPubKey?.hex) {
        console.warn(`Warning: No OP_RETURN data found in transaction ${tx.txid}`);
        continue;
      }

      const parsed = parseOpReturn(opReturnOutput.scriptPubKey.hex);
      if (!parsed) {
        console.warn(`Warning: Failed to parse OP_RETURN data for transaction ${tx.txid}`);
        continue;
      }

      // Create stake transaction with phase-specific overflow status
      const stakeTransaction = await this.createStakeTransaction(
        tx,
        parsed,
        block,
        amount,
        { 
          ...validationResult,
          isOverflow,
          overflowAmount: isOverflow ? amount : 0
        }
      );

      if (stakeTransaction) {
        transactions.push({
          ...stakeTransaction,
          isValid: validationResult.isValid,
          hasBabylonPrefix: true
        });

        // Only update active stake for phase 1
        if (phase === 1 && validationResult.isValid && !isOverflow) {
          currentActiveStake += amount;
        }
      }
    }

    return transactions;
  }

  async getAllFinalityProviders(
    skip: number = 0,
    limit: number = 10,
    sortBy: string = 'totalStake',
    order: 'asc' | 'desc' = 'desc',
    includeStakers: boolean = false,
    stakersSkip?: number,
    stakersLimit?: number
  ): Promise<FinalityProviderStats[]> {
    return this.db.getFinalityProviders(skip, limit, sortBy, order, includeStakers, stakersSkip, stakersLimit);
  }

  async getFinalityProvidersCount(): Promise<number> {
    return this.db.getFinalityProvidersCount();
  }

  async getTopFinalityProviders(
    skip: number = 0,
    limit: number = 10,
    sortBy: string = 'totalStake',
    order: 'asc' | 'desc' = 'desc',
    includeStakers: boolean = false
  ): Promise<FinalityProviderStats[]> {
    return this.db.getFinalityProviders(skip, limit, sortBy, order, includeStakers);
  }

  async getFinalityProviderStats(
    address: string, 
    timeRange?: TimeRange,
    skip?: number,
    limit?: number
  ): Promise<FinalityProviderStats> {
    return this.db.getFPStats(address, timeRange, skip, limit);
  }

  async getTopStakers(
    skip: number = 0,
    limit: number = 10,
    sortBy: string = 'totalStake',
    order: 'asc' | 'desc' = 'desc',
    includeTransactions: boolean = false
  ): Promise<StakerStats[]> {
    return this.db.getTopStakers(skip, limit, sortBy, order, includeTransactions);
  }

  async getStakersCount(): Promise<number> {
    return this.db.getStakersCount();
  }

  async getStakerStats(
    address: string, 
    timeRange?: TimeRange,
    includeTransactions: boolean = false
  ): Promise<StakerStats> {
    return this.db.getStakerStats(address, timeRange, includeTransactions);
  }

  async getVersionStats(version: number, timeRange?: TimeRange): Promise<VersionStats> {
    return this.db.getVersionStats(version, timeRange);
  }

  async getGlobalStats() {
    return this.db.getGlobalStats();
  }

  async getFinalityProviderTotalStakers(
    address: string,
    timeRange?: TimeRange
  ): Promise<number> {
    return this.db.getFinalityProviderTotalStakers(address, timeRange);
  }
} 