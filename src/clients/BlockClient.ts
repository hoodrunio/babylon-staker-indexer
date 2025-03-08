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
        gas_wanted?: string;
        gas_used?: string;
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
                    })),
                    gas_wanted: txResult.gas_wanted || '0',
                    gas_used: txResult.gas_used || '0'
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
     * En son bloğu alır
     */
    public async getLatestBlock(): Promise<{
        block: {
            header: {
                height: string;
                time: string;
            };
            data: any;
        };
    }> {
        try {
            logger.debug(`[BlockClient] Getting latest block for ${this.network}`);
            
            const response = await this.client.get('/cosmos/base/tendermint/v1beta1/blocks/latest');
            
            if (!response || !response.data || !response.data.block) {
                logger.error(`[BlockClient] Invalid response from Babylon node for ${this.network}`);
                throw new Error('Invalid response from Babylon node');
            }
            
            // Daha detaylı kontrol
            if (!response.data.block.header || !response.data.block.header.height) {
                logger.error(`[BlockClient] Missing header or height in response for ${this.network}`);
                throw new Error('Missing header or height in response');
            }
            
            return {
                block: {
                    header: {
                        height: response.data.block.header.height,
                        time: response.data.block.header.time
                    },
                    data: response.data.block.data
                }
            };
        } catch (error) {
            logger.error(`[BlockClient] Error getting latest block for ${this.network}:`, error);
            throw error;
        }
    }

    /**
     * Belirli bir yükseklikteki bloğu alır
     * @param height Blok yüksekliği
     */
    public async getBlockByHeight(height: number): Promise<any> {
        try {
            logger.debug(`[BlockClient] Getting block at height ${height} for ${this.network}`);
            
            const url = new URL(`${this.baseRpcUrl}/block`);
            url.searchParams.append('height', height.toString());
            
            // Daha uzun bir timeout ile deneyelim
            const response = await this.fetchWithTimeout(url.toString(), 15000);
            
            // Yanıt durumunu kontrol et
            if (!response.ok) {
                logger.error(`[BlockClient] HTTP error ${response.status} for block at height ${height} for ${this.network}`);
                throw new Error(`HTTP error ${response.status} for block at height ${height}`);
            }
            
            // JSON yanıtını parse et
            const data = await response.json() as any;
            
            // Veri yapısını kontrol et
            if (!data || !data.result || !data.result.block) {
                logger.error(`[BlockClient] Invalid response for block at height ${height} for ${this.network}: ${JSON.stringify(data)}`);
                throw new Error(`Invalid response for block at height ${height}`);
            }
            
            return data;
        } catch (error) {
            // Hata detaylarını logla
            if (error instanceof Error) {
                logger.error(`[BlockClient] Error getting block at height ${height} for ${this.network}: ${error.message}`);
                if (error.stack) {
                    logger.debug(`[BlockClient] Error stack: ${error.stack}`);
                }
            } else {
                logger.error(`[BlockClient] Unknown error getting block at height ${height} for ${this.network}`);
            }
            
            // Alternatif bir yöntem deneyelim - Axios ile
            try {
                logger.debug(`[BlockClient] Retrying with axios for block at height ${height} for ${this.network}`);
                
                const axiosResponse = await this.client.get(`${this.baseRpcUrl}/block?height=${height}`);
                
                if (!axiosResponse.data || !axiosResponse.data.result || !axiosResponse.data.result.block) {
                    logger.error(`[BlockClient] Invalid axios response for block at height ${height} for ${this.network}`);
                    throw new Error(`Invalid axios response for block at height ${height}`);
                }
                
                return axiosResponse.data;
            } catch (axiosError) {
                logger.error(`[BlockClient] Axios retry also failed for block at height ${height} for ${this.network}`);
                throw error; // Orijinal hatayı fırlat
            }
        }
    }
    
    /**
     * Verilen yükseklikteki işlemleri arar
     * @param height İşlemlerin aranacağı blok yüksekliği
     */
    public async getTxSearch(height: number): Promise<any> {
        try {
            logger.debug(`[BlockClient] Fetching transactions for height ${height} for ${this.network}`);
            
            const url = new URL(`${this.baseRpcUrl}/tx_search`);
            url.searchParams.append('query', `"tx.height=${height}"`);
            url.searchParams.append('page', '1');
            url.searchParams.append('per_page', '500');
            
            logger.debug(`[BlockClient] Fetching transactions from: ${url.toString()}`);
            
            // Daha uzun bir timeout ile deneyelim
            const response = await this.fetchWithTimeout(url.toString(), 15000);
            
            // Yanıt durumunu kontrol et
            if (!response.ok) {
                logger.error(`[BlockClient] HTTP error ${response.status} for tx_search at height ${height} for ${this.network}`);
                throw new Error(`HTTP error ${response.status} for tx_search at height ${height}`);
            }
            
            // JSON yanıtını parse et
            const data = await response.json() as any;
            
            // Veri yapısını kontrol et
            if (!data || !data.result) {
                logger.error(`[BlockClient] Invalid response for tx_search at height ${height} for ${this.network}: ${JSON.stringify(data)}`);
                throw new Error(`Invalid response for tx_search at height ${height}`);
            }
            
            // tx_search.json formatına uygun olarak döndür
            return {
                jsonrpc: data.jsonrpc,
                id: data.id,
                result: {
                    txs: data.result.txs || [],
                    total_count: data.result.total_count || "0"
                }
            };
        } catch (error) {
            // Hata detaylarını logla
            if (error instanceof Error) {
                logger.error(`[BlockClient] Error getting transactions for height ${height} for ${this.network}: ${error.message}`);
                if (error.stack) {
                    logger.debug(`[BlockClient] Error stack: ${error.stack}`);
                }
            } else {
                logger.error(`[BlockClient] Unknown error getting transactions for height ${height} for ${this.network}`);
            }
            
            // Alternatif bir yöntem deneyelim - Axios ile
            try {
                logger.debug(`[BlockClient] Retrying tx_search with axios for height ${height} for ${this.network}`);
                
                const axiosResponse = await this.client.get(`${this.baseRpcUrl}/tx_search`, {
                    params: {
                        query: `"tx.height=${height}"`,
                        page: 1,
                        per_page: 500
                    }
                });
                
                if (!axiosResponse.data || !axiosResponse.data.result) {
                    logger.error(`[BlockClient] Invalid axios response for tx_search at height ${height} for ${this.network}`);
                    throw new Error(`Invalid axios response for tx_search at height ${height}`);
                }
                
                // tx_search.json formatına uygun olarak döndür
                return {
                    jsonrpc: axiosResponse.data.jsonrpc,
                    id: axiosResponse.data.id,
                    result: {
                        txs: axiosResponse.data.result.txs || [],
                        total_count: axiosResponse.data.result.total_count || "0"
                    }
                };
            } catch (axiosError) {
                logger.error(`[BlockClient] Axios retry also failed for tx_search at height ${height} for ${this.network}`);
                throw error; // Orijinal hatayı fırlat
            }
        }
    }

    public async getBlockByHash(hash: string): Promise<any> {
        try {
            const response = await this.client.get(`${this.baseRpcUrl}/block?hash=0x${hash}`);
            return response.data;
        } catch (error) {
            logger.error(`[BlockClient] Error getting block by hash ${hash}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;    
        }
    }
} 