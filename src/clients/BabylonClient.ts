import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import WebSocket from 'ws';
import { EpochInfo } from '../types/finality';

interface Vote {
    fp_btc_pk_hex: string;
    signature: string;
    timestamp: string;
}

interface CurrentEpochResponse {
    current_epoch: number;
    epoch_boundary: number;
}

// Axios config için custom tip tanımı
interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
    retry?: boolean;
    currentRetryCount?: number;
}

export class BabylonClient {
    private static instance: BabylonClient | null = null;
    private readonly client: AxiosInstance;
    private readonly wsEndpoint: string;
    private epochCache: Map<number, EpochInfo> = new Map();
    private currentEpochInfo: CurrentEpochResponse | null = null;
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 1000; // 1 saniye

    private constructor(babylonNodeUrl: string, babylonRpcUrl: string) {
        this.client = axios.create({
            baseURL: babylonNodeUrl,
            timeout: 15000, // 15 saniye
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            }
        });

        // Retry interceptor ekle
        this.client.interceptors.response.use(undefined, async (err: AxiosError) => {
            const config = err.config as CustomAxiosRequestConfig;
            if (!config || !config.retry) {
                return Promise.reject(err);
            }

            config.currentRetryCount = config.currentRetryCount ?? 0;

            if (config.currentRetryCount >= this.MAX_RETRIES) {
                return Promise.reject(err);
            }

            config.currentRetryCount += 1;
            
            const delayTime = this.RETRY_DELAY * config.currentRetryCount;
            await new Promise(resolve => setTimeout(resolve, delayTime));

            console.debug(`[Retry] Attempt ${config.currentRetryCount} for ${config.url}`);
            return this.client(config);
        });
        
        // Her request'e retry config'i ekle
        this.client.interceptors.request.use((config: CustomAxiosRequestConfig) => {
            config.retry = true;
            config.currentRetryCount = 0;
            return config;
        });
        
        this.wsEndpoint = babylonRpcUrl.replace(/^http/, 'ws') + '/websocket';
    }

    public static getInstance(babylonNodeUrl?: string, babylonRpcUrl?: string): BabylonClient {
        if (!BabylonClient.instance) {
            if (!babylonNodeUrl || !babylonRpcUrl) {
                throw new Error('BabylonClient needs both babylonNodeUrl and babylonRpcUrl for initialization');
            }
            BabylonClient.instance = new BabylonClient(babylonNodeUrl, babylonRpcUrl);
        }
        return BabylonClient.instance;
    }

    public getWsEndpoint(): string {
        return this.wsEndpoint;
    }

    async getCurrentHeight(): Promise<number> {
        try {
            const response = await this.client.get('/cosmos/base/tendermint/v1beta1/blocks/latest');
            return parseInt(response.data.block.header.height, 10);
        } catch (error) {
            if (error instanceof Error) {
                console.error('[Height] Failed to get current height:', error.message);
            } else {
                console.error('[Height] Failed to get current height:', error);
            }
            throw new Error('Failed to get current height');
        }
    }

    async getVotesAtHeight(height: number): Promise<Vote[]> {
        try {
            const response = await this.client.get(`/babylon/finality/v1/votes/${height}`);
            
            if (!response.data || !response.data.btc_pks) {
                console.warn(`[Votes] No btc_pks in response for height ${height}`);
                return [];
            }

            const currentTime = new Date().toISOString();
            return response.data.btc_pks.map((btcPk: string) => ({
                fp_btc_pk_hex: btcPk.toLowerCase(),
                signature: '',
                timestamp: currentTime
            }));
        } catch (error) {
            if (error instanceof Error) {
                console.error(`[Votes] Error fetching votes at height ${height}:`, error.message);
            } else {
                console.error(`[Votes] Error fetching votes at height ${height}:`, error);
            }
            return [];
        }
    }

    async getCurrentEpoch(): Promise<CurrentEpochResponse> {
        try {
            const response = await this.client.get('/babylon/epoching/v1/current_epoch');
            console.debug('[Current Epoch Response]', response.data);

            const current_epoch = Number(response.data.current_epoch);
            const epoch_boundary = Number(response.data.epoch_boundary);

            if (isNaN(current_epoch) || isNaN(epoch_boundary)) {
                throw new Error('Invalid epoch data received from API');
            }

            this.currentEpochInfo = { current_epoch, epoch_boundary };
            return this.currentEpochInfo;
        } catch (error) {
            console.error('Error fetching current epoch:', error);
            throw error;
        }
    }

    async calculateEpochForHeight(height: number): Promise<EpochInfo> {
        // Cache'den kontrol et
        for (const [_, epochInfo] of this.epochCache) {
            if (height >= epochInfo.startHeight && height <= epochInfo.endHeight) {
                return epochInfo;
            }
        }

        try {
            // Mevcut epoch bilgisini al
            const currentEpoch = await this.getCurrentEpoch();
            height = Number(height);

            // Eğer height, mevcut epoch'un boundary'sinden küçükse, mevcut epoch'tayız
            if (height <= currentEpoch.epoch_boundary) {
                const epochInfo: EpochInfo = {
                    epochNumber: currentEpoch.current_epoch,
                    startHeight: currentEpoch.epoch_boundary - 360, // Önceki boundary
                    endHeight: currentEpoch.epoch_boundary
                };
                this.epochCache.set(epochInfo.epochNumber, epochInfo);
                return epochInfo;
            } else {
                // Sonraki epoch
                const epochInfo: EpochInfo = {
                    epochNumber: currentEpoch.current_epoch + 1,
                    startHeight: currentEpoch.epoch_boundary,
                    endHeight: currentEpoch.epoch_boundary + 99 // Sonraki boundary
                };
                this.epochCache.set(epochInfo.epochNumber, epochInfo);
                return epochInfo;
            }
        } catch (error) {
            console.error('Error calculating epoch:', error);
            throw error;
        }
    }
} 