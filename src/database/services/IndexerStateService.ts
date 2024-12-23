import { IndexerState } from '../models/IndexerState';

export class IndexerStateService {
  async getLastProcessedBlock(): Promise<number> {
    const state = await IndexerState.findOne();
    return state?.lastProcessedBlock || 0;
  }

  async updateLastProcessedBlock(height: number): Promise<void> {
    await IndexerState.findOneAndUpdate(
      {},
      { lastProcessedBlock: height },
      { upsert: true }
    );
  }
}
