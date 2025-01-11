import axios, { AxiosInstance } from 'axios';
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

export class BabylonClient {
    private static instance: BabylonClient | null = null;
    private readonly client: AxiosInstance;
    private readonly wsEndpoint: string;
    private epochCache: Map<number, EpochInfo> = new Map();
    private currentEpochInfo: CurrentEpochResponse | null = null;

    private constructor(babylonNodeUrl: string, babylonRpcUrl: string) {
        this.client = axios.create({
            baseURL: babylonNodeUrl,
            timeout: 5000
        });
        
        // WebSocket endpoint'i RPC URL'den oluştur
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
        const response = await this.client.get('/cosmos/base/tendermint/v1beta1/blocks/latest');
        return parseInt(response.data.block.header.height, 10);
    }

    async getVotesAtHeight(height: number): Promise<Vote[]> {
        try {
            const response = await this.client.get(`/babylon/finality/v1/votes/${height}`);
            
            if (!response.data || !response.data.btc_pks) {
                console.warn(`No btc_pks in response for height ${height}`);
                return [];
            }

            const currentTime = new Date().toISOString();
            return response.data.btc_pks.map((btcPk: string) => ({
                fp_btc_pk_hex: btcPk.toLowerCase(),
                signature: '',
                timestamp: currentTime
            }));
        } catch (error) {
            console.error(`Error fetching votes at height ${height}:`, error);
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