import axios from 'axios';

export class BitcoinRPC {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async call(method: string, params: any[] = []): Promise<any> {
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
  }

  async getBlock(height: number): Promise<any> {
    const hash = await this.call('getblockhash', [height]);
    return this.call('getblock', [hash, 2]);
  }
} 