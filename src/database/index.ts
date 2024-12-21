import mongoose from 'mongoose';
import dotenv from 'dotenv';
import {
  TransactionService,
  FinalityProviderService,
  StakerService,
  PhaseStatsService,
  IndexerStateService,
  StatsService
} from './services';

dotenv.config();

export class Database {
  private static instance: Database | null = null;
  private isConnected: boolean = false;

  private transactionService: TransactionService;
  private finalityProviderService: FinalityProviderService;
  private stakerService: StakerService;
  private phaseStatsService: PhaseStatsService;
  private indexerStateService: IndexerStateService;
  private statsService: StatsService;

  constructor() {
    this.transactionService = new TransactionService();
    this.finalityProviderService = new FinalityProviderService();
    this.stakerService = new StakerService();
    this.phaseStatsService = new PhaseStatsService();
    this.indexerStateService = new IndexerStateService();
    this.statsService = new StatsService();
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    try {
      await mongoose.connect(process.env.MONGODB_URI!);
      this.isConnected = true;
      if (process.env.LOG_LEVEL === 'debug') {
        console.log('Connected to MongoDB successfully');
      }
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  }

  // Transaction methods
  async saveTransaction(tx: any): Promise<void> {
    return this.transactionService.saveTransaction(tx);
  }

  async saveTransactionBatch(transactions: any[]): Promise<void> {
    return this.transactionService.saveTransactionBatch(transactions);
  }

  async getTransactionsByBlockRange(startHeight: number, endHeight: number): Promise<any[]> {
    return this.transactionService.getTransactionsByBlockRange(startHeight, endHeight);
  }

  // FinalityProvider methods
  async getFPStats(address: string, timeRange?: any): Promise<any> {
    return this.finalityProviderService.getFPStats(address, timeRange);
  }

  async getAllFPs(): Promise<any[]> {
    return this.finalityProviderService.getAllFPs();
  }

  async getTopFPs(limit?: number): Promise<any[]> {
    return this.finalityProviderService.getTopFPs(limit);
  }

  // Staker methods
  async getStakerStats(address: string, timeRange?: any): Promise<any> {
    return this.stakerService.getStakerStats(address, timeRange);
  }

  async getTopStakers(limit?: number): Promise<any[]> {
    return this.stakerService.getTopStakers(limit);
  }

  async reindexStakers(): Promise<void> {
    return this.stakerService.reindexStakers();
  }

  async debugStakerSearch(address: string): Promise<void> {
    return this.stakerService.debugStakerSearch(address);
  }

  // PhaseStats methods
  async initPhaseStats(phase: number, startHeight: number): Promise<void> {
    return this.phaseStatsService.initPhaseStats(phase, startHeight);
  }

  async updatePhaseStats(phase: number, height: number, transaction?: any): Promise<void> {
    return this.phaseStatsService.updatePhaseStats(phase, height, transaction);
  }

  async updatePhaseStatsBatch(phase: number, height: number, transactions: any[]): Promise<void> {
    return this.phaseStatsService.updatePhaseStatsBatch(phase, height, transactions);
  }

  async completePhase(phase: number, height: number, reason: 'target_reached' | 'timeout' | 'inactivity' | 'block_height'): Promise<void> {
    return this.phaseStatsService.completePhase(phase, height, reason);
  }

  async getPhaseStats(phase: number): Promise<any> {
    return this.phaseStatsService.getPhaseStats(phase);
  }

  async getAllPhaseStats(): Promise<any[]> {
    return this.phaseStatsService.getAllPhaseStats();
  }

  // IndexerState methods
  async getLastProcessedBlock(): Promise<number> {
    return this.indexerStateService.getLastProcessedBlock();
  }

  async updateLastProcessedBlock(height: number): Promise<void> {
    return this.indexerStateService.updateLastProcessedBlock(height);
  }

  // Stats methods
  async getVersionStats(version: number, timeRange?: any): Promise<any> {
    return this.statsService.getVersionStats(version, timeRange);
  }

  async getGlobalStats(): Promise<any> {
    return this.statsService.getGlobalStats();
  }
}
