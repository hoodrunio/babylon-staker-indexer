import axios, { AxiosInstance } from 'axios';

interface Vote {
    fp_btc_pk_hex: string;
    signature: string;
    timestamp: string;
}

interface VoteResponse {
    finality_providers: Array<{
        btc_pk_hex: string;
        signature: string;
        timestamp: string;
    }>;
}

interface ApiResponse<T> {
    data: T;
}

interface EpochInfo {
    epoch_number: number;
    current_epoch_interval: number;
    first_block_height: number;
    last_block_time?: string;
    sealer_app_hash_hex?: string;
    sealer_block_hash?: string;
}

interface CurrentEpochResponse {
    current_epoch: number;
    epoch_boundary: number;
}

export class BabylonClient {
    private static instance: BabylonClient | null = null;
    private readonly client: AxiosInstance;
    private epochCache: Map<number, EpochInfo> = new Map();

    private constructor(babylonNodeUrl: string) {
        this.client = axios.create({
            baseURL: babylonNodeUrl,
            timeout: 5000
        });
    }

    public static getInstance(babylonNodeUrl?: string): BabylonClient {
        if (!BabylonClient.instance) {
            if (!babylonNodeUrl) {
                throw new Error('BabylonClient needs babylonNodeUrl for first initialization');
            }
            BabylonClient.instance = new BabylonClient(babylonNodeUrl);
        }
        return BabylonClient.instance;
    }

    async getCurrentHeight(): Promise<number> {
        const response = await this.client.get('/cosmos/base/tendermint/v1beta1/blocks/latest');
        return parseInt(response.data.block.header.height, 10);
    }

    async getVotesAtHeight(height: number): Promise<Vote[]> {
        try {
            const response = await this.client.get(`/babylon/finality/v1/votes/${height}`);
            
            // API yanıtını debug için logla
            console.debug(`API Response for height ${height}:`, JSON.stringify(response.data, null, 2));
            
            // API yanıtının yapısını kontrol et
            if (!response.data || !response.data.btc_pks) {
                console.warn(`No btc_pks in response for height ${height}`);
                return [];
            }

            // Her public key için bir Vote objesi oluştur
            const currentTime = new Date().toISOString();
            const votes = response.data.btc_pks.map((btcPk: string) => ({
                fp_btc_pk_hex: btcPk.toLowerCase(), // Normalize et
                signature: '', // API bu bilgiyi sağlamıyor
                timestamp: currentTime
            }));

            console.debug(`Transformed votes for height ${height}:`, JSON.stringify(votes, null, 2));
            return votes;
        } catch (error) {
            console.error(`Error fetching votes at height ${height}:`, error);
            if (axios.isAxiosError(error)) {
                console.error('API Response:', error.response?.data);
            }
            return [];
        }
    }

    async getCurrentEpoch(): Promise<CurrentEpochResponse> {
        const response = await this.client.get('/babylon/epoching/v1/current_epoch');
        return response.data;
    }

    async getEpochInfo(epochNum: number): Promise<EpochInfo> {
        // Cache'den kontrol et
        const cachedEpoch = this.epochCache.get(epochNum);
        if (cachedEpoch) {
            return cachedEpoch;
        }

        const response = await this.client.get(`/babylon/epoching/v1/epochs/${epochNum}`);
        const epochInfo = response.data.epoch;
        
        // Cache'e kaydet
        this.epochCache.set(epochNum, epochInfo);
        
        return epochInfo;
    }

    async getEpochByHeight(height: number): Promise<EpochInfo> {
        try {
            // Önce mevcut epoch bilgisini al
            const currentEpochResponse = await this.getCurrentEpoch();
            const currentEpoch = currentEpochResponse.current_epoch;
            
            // Epoch listesini al (en son epoch'lardan başlayarak)
            const response = await this.client.get('/babylon/epoching/v1/epochs', {
                params: {
                    'pagination.reverse': true,
                    'pagination.limit': 100 // Makul bir limit
                }
            });
            
            const epochs: EpochInfo[] = response.data.epochs || [];
            
            // Epoch'ları first_block_height'e göre sırala
            epochs.sort((a, b) => Number(b.first_block_height) - Number(a.first_block_height));
            
            // Height'e göre uygun epoch'u bul
            for (let i = 0; i < epochs.length; i++) {
                const currentEpochInfo = epochs[i];
                const nextEpochInfo = epochs[i - 1]; // Bir önceki index çünkü ters sıralı
                
                const epochStartHeight = Number(currentEpochInfo.first_block_height);
                const epochEndHeight = nextEpochInfo 
                    ? Number(nextEpochInfo.first_block_height) - 1 
                    : Number(currentEpochResponse.epoch_boundary);
                
                if (height >= epochStartHeight && height <= epochEndHeight) {
                    console.debug(`Found epoch for height ${height}:`, {
                        epochNumber: currentEpochInfo.epoch_number,
                        startHeight: epochStartHeight,
                        endHeight: epochEndHeight
                    });
                    return currentEpochInfo;
                }
            }
            
            throw new Error(`No epoch found for height ${height}`);
        } catch (error) {
            console.error(`Error getting epoch for height ${height}:`, error);
            throw this.handleError(error);
        }
    }

    async getSigningInfo(fpBtcPkHex: string): Promise<any> {
        const response = await this.client.get(`/babylon/finality/v1/signing_infos/${fpBtcPkHex}`);
        return response.data.signing_info;
    }

    async getAllSigningInfos(): Promise<any[]> {
        const response = await this.client.get('/babylon/finality/v1/signing_infos');
        return response.data.signing_infos || [];
    }

    // Hata yönetimi için özel bir metod
    private handleError(error: any): never {
        if (error.response) {
            throw new Error(`Babylon API error: ${error.response.status} - ${error.response.data.message || 'Unknown error'}`);
        } else if (error.request) {
            throw new Error('No response from Babylon node');
        } else {
            throw new Error(`Request error: ${error.message}`);
        }
    }
} 