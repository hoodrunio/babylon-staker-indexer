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
import { FinalityProviderStats, StakerStats, TimeRange } from '../types';
import { logger } from '../utils/logger';

dotenv.config();

export class Database {
  private static instance: Database | null = null;
  private isConnected: boolean = false;
  private db: mongoose.Connection;

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
    this.db = mongoose.connection;
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
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) {
        throw new Error('MONGODB_URI is not defined in environment variables');
      }

      logger.info('Connecting to MongoDB...');
      
      await mongoose.connect(mongoUri);
      this.isConnected = true;
      this.db = mongoose.connection;
      
      logger.info('MongoDB connected successfully');
      logger.info('Database name:', this.db.name);
      /* if (this.db.db) {
        logger.info('Collections:', await this.db.db.collections());
      } */

      // Connection events
      mongoose.connection.on('error', err => {
        logger.error('MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
      });

    } catch (error) {
      logger.error('Error connecting to MongoDB:', error);
      process.exit(1);
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
  async getFPStats(
    address: string, 
    timeRange?: TimeRange,
    skip?: number,
    limit?: number,
    search?: string,
    sortBy?: string,
    sortOrder?: 'asc' | 'desc'
  ): Promise<FinalityProviderStats> {
    return this.finalityProviderService.getFPStats(address, timeRange, skip, limit, search, sortBy, sortOrder);
  }

  async getAllFPs(): Promise<any[]> {
    return this.finalityProviderService.getAllFPs();
  }

  async getTopFPs(limit?: number): Promise<any[]> {
    return this.finalityProviderService.getTopFPs(limit);
  }

  // Staker methods
  async getStakerStats(
    address: string, 
    timeRange?: TimeRange,
    includeTransactions: boolean = false,
    skip?: number,
    limit?: number,
    sortBy: string = 'totalStake',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<StakerStats> {
    return this.stakerService.getStakerStats(address, timeRange, includeTransactions, skip, limit, sortBy, sortOrder);
  }

  async getTopStakers(
    skip: number = 0,
    limit: number = 10,
    sortBy: string = 'totalStake',
    order: 'asc' | 'desc' = 'desc',
    includeTransactions: boolean = false,
    transactionsSkip?: number,
    transactionsLimit?: number
  ): Promise<StakerStats[]> {
    return this.stakerService.getTopStakers(skip, limit, sortBy, order, includeTransactions, transactionsSkip, transactionsLimit);
  }

  async getStakersCount(): Promise<number> {
    return this.stakerService.getStakersCount();
  }

  async reindexStakers(): Promise<void> {
    return this.stakerService.reindexStakers();
  }

  async reindexFinalityProviders(): Promise<void> {
    return this.finalityProviderService.reindexFinalityProviders();
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

  async getFinalityProviders(
    skip: number = 0,
    limit: number = 10,
    sortBy: string = 'totalStake',
    order: 'asc' | 'desc' = 'desc',
    includeStakers: boolean = false,
    stakersSkip?: number,
    stakersLimit?: number
  ): Promise<FinalityProviderStats[]> {
    return this.finalityProviderService.getAllFPs(skip, limit, sortBy, order, includeStakers, stakersSkip, stakersLimit);
  }

  async getFinalityProvidersCount(): Promise<number> {
    return this.finalityProviderService.getFinalityProvidersCount();
  }

  async getFinalityProviderTotalStakers(
    address: string,
    timeRange?: TimeRange
  ): Promise<number> {
    return this.finalityProviderService.getFinalityProviderTotalStakers(address, timeRange);
  }

  async getStakerTotalTransactions(
    address: string,
    timeRange?: TimeRange
  ): Promise<number> {
    return this.stakerService.getStakerTotalTransactions(address, timeRange);
  }
}
