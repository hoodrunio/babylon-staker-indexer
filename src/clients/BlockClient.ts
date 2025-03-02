import { BaseClient } from './BaseClient';
import { logger } from '../utils/logger';
import axios from 'axios';

export interface BlockResult {
    height: number;
    txs_results: Array<{
        events: Array<{
            type: string;
            attributes: Array<{
                key: string;
                value: string;
            }>;
        }>;
    }>;
}

/**
 * Blok verilerini almak için kullanılan istemci
 */
export class BlockClient extends BaseClient {
    /**
     * @param network Ağ tipi
     * @param nodeUrl Node URL
     * @param rpcUrl RPC URL
     * @param wsUrl WebSocket URL (opsiyonel)
     */
    public constructor(
        network: any,
        nodeUrl: string,
        rpcUrl: string,
        wsUrl?: string
    ) {
        super(network, nodeUrl, rpcUrl, wsUrl);
    }

    /**
     * Mevcut blok yüksekliğini alır
     */
    public async getCurrentHeight(): Promise<number> {
        return this.retryOperation(
            async () => {
                const response = await this.client.post(this.baseRpcUrl, {
                    jsonrpc: "2.0",
                    id: -1,
                    method: "abci_info",
                    params: []
                });

                if (response.data?.result?.response?.last_block_height) {
                    return parseInt(response.data.result.response.last_block_height, 10);
                }

                throw new Error('Invalid response format from RPC endpoint');
            },
            0,
            'getCurrentHeight'
        );
    }

    /**
     * Belirtilen yükseklikteki blok sonuçlarını alır
     * @param height Blok yüksekliği
     */
    async getBlockResults(height: number): Promise<BlockResult | null> {
        try {
            logger.debug(`[Block Results] Fetching results for height ${height}`);

            const response = await axios.get(`${this.baseRpcUrl}/block_results?height=${height}`);
            
            if (!response.data?.result) {
                logger.warn(`[Block Results] No data in response for height ${height}`);
                return null;
            }

            // Convert RPC response to the format expected by MissedBlocksProcessor
            const formattedResults: BlockResult = {
                height: height,
                txs_results: (response.data.result.txs_results || []).map((txResult: any) => ({
                    events: (txResult.events || []).map((event: any) => ({
                        type: event.type,
                        attributes: event.attributes || []
                    }))
                }))
            };

            return formattedResults;
        } catch (error) {
            if (error instanceof Error) {
                logger.error(`[Block Results] Error fetching block results at height ${height}:`, error.message);
            } else {
                logger.error(`[Block Results] Error fetching block results at height ${height}:`, error);
            }
            throw error;
        }
    }

    /**
     * En son blok bilgilerini alır
     */
    public async getLatestBlock(): Promise<{
        header: {
            height: number;
            time: string;
        };
        data: any;
    }> {
        try {
            logger.debug(`[BlockClient] Getting latest block for ${this.network}`);
            
            const response = await this.client.get('/cosmos/base/tendermint/v1beta1/blocks/latest');
            
            if (!response || !response.data || !response.data.block) {
                throw new Error('Invalid response from Babylon node');
            }
            
            return {
                header: {
                    height: parseInt(response.data.block.header.height),
                    time: response.data.block.header.time
                },
                data: response.data.block.data
            };
        } catch (error) {
            logger.error(`[BlockClient] Error getting latest block for ${this.network}:`, error);
            throw error;
        }
    }

    /**
     * Verilen yükseklikteki işlemleri arar
     * @param height İşlemlerin aranacağı blok yüksekliği
     */
    public async getTxSearch(height: number): Promise<any> {
        const url = new URL(`${this.baseRpcUrl}/tx_search`);
        url.searchParams.append('query', `"tx.height=${height}"`);
        url.searchParams.append('page', '1');
        url.searchParams.append('per_page', '500');

        logger.debug(`[BlockClient] Fetching transactions from: ${url.toString()}`);

        const response = await this.fetchWithTimeout(url.toString());
        const data = await response.json() as { result: any };
        return data.result;
    }
} 