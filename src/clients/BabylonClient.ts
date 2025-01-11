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
    first_block_height: number;
    current_epoch_interval: number;
}

export class BabylonClient {
    private static instance: BabylonClient | null = null;
    private readonly client: AxiosInstance;
    private readonly wsEndpoint: string;
    private epochCache: Map<number, EpochInfo> = new Map();

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
        const response = await this.client.get('/babylon/epoching/v1/current_epoch');
        return {
            current_epoch: response.data.current_epoch,
            first_block_height: response.data.first_block_height,
            current_epoch_interval: response.data.current_epoch_interval
        };
    }

    async calculateEpochForHeight(height: number): Promise<EpochInfo> {
        // Cache'den epoch bilgisini kontrol et
        for (const [_, epochInfo] of this.epochCache) {
            const endHeight = epochInfo.startHeight + epochInfo.interval - 1;
            if (height >= epochInfo.startHeight && height <= endHeight) {
                return epochInfo;
            }
        }

        // Cache'de yoksa, current epoch bilgisini al
        const currentEpoch = await this.getCurrentEpoch();
        
        // Epoch numarasını hesapla
        const epochNumber = Math.floor(
            (height - currentEpoch.first_block_height) / currentEpoch.current_epoch_interval
        ) + currentEpoch.current_epoch;

        // Epoch başlangıç yüksekliğini hesapla
        const startHeight = currentEpoch.first_block_height + 
            (epochNumber - currentEpoch.current_epoch) * currentEpoch.current_epoch_interval;

        const epochInfo: EpochInfo = {
            epochNumber,
            startHeight,
            interval: currentEpoch.current_epoch_interval
        };

        // Cache'e kaydet
        this.epochCache.set(epochNumber, epochInfo);
        
        return epochInfo;
    }
} 