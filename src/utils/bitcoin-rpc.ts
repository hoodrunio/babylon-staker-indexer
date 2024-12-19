import axios from 'axios';

export class BitcoinRPC {
  private url: string;
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private readonly RATE_LIMIT = 10; // requests per second
  private readonly RETRY_DELAYS = [1000, 2000, 4000, 8000]; // exponential backoff delays in ms

  constructor(url: string) {
    this.url = url;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        await request();
        await this.sleep(1000 / this.RATE_LIMIT); // Ensure we don't exceed rate limit
      }
    }

    this.isProcessingQueue = false;
  }

  private async makeRequest(method: string, params: any[] = [], retryCount = 0): Promise<any> {
    try {
      const response = await axios.post(this.url, {
        jsonrpc: '1.0',
        id: 'btc',
        method,
        params
      });
      
      if (response.data.error) {
        throw new Error(response.data.error.message);
      }
      
      return response.data.result;
    } catch (error: any) {
      if (error.response?.status === 429 && retryCount < this.RETRY_DELAYS.length) {
        const delay = this.RETRY_DELAYS[retryCount];
        console.log(`Rate limited. Retrying after ${delay}ms...`);
        await this.sleep(delay);
        return this.makeRequest(method, params, retryCount + 1);
      }
      throw error;
    }
  }

  async call(method: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await this.makeRequest(method, params);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  async getBlock(height: number): Promise<any> {
    const hash = await this.call('getblockhash', [height]);
    return this.call('getblock', [hash, 3]); // Use verbosity 3 to get prevout info
  }
} 