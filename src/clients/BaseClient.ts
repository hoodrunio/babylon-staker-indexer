import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Network } from '../types/finality';
import { logger } from '../utils/logger';

export interface RetryConfig extends InternalAxiosRequestConfig {
    retry?: boolean;
    currentRetryCount?: number;
}

/**
 * Farklı API istemcileri için temel sınıf.
 * HTTP istekleri, yeniden deneme mantığı ve ağ yapılandırmasını sağlar.
 */
export abstract class BaseClient {
    protected readonly client: AxiosInstance;
    protected readonly network: Network;
    protected readonly baseUrl: string;
    protected readonly baseRpcUrl: string;
    protected readonly wsEndpoint: string;
    protected readonly MAX_RETRIES = 5;
    protected readonly RETRY_DELAY = 2000; // 2 seconds
    protected readonly MAX_RETRY_DELAY = 10000; // 10 seconds

    public constructor(
        network: Network,
        nodeUrl: string,
        rpcUrl: string,
        wsUrl?: string,
        additionalHeaders: Record<string, string> = {}
    ) {
        this.network = network;
        this.baseUrl = nodeUrl;
        this.baseRpcUrl = rpcUrl;

        if (!wsUrl) {
            logger.warn(`WebSocket URL not configured for ${network} network, falling back to RPC URL`);
            this.wsEndpoint = `${rpcUrl.replace(/^http/, 'ws')}/websocket`;
        } else {
            this.wsEndpoint = wsUrl;
        }

        // Create HTTP client
        this.client = axios.create({
            baseURL: nodeUrl,
            timeout: 30000,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Network': network,
                ...additionalHeaders
            }
        });

        // Setup retry mechanism for requests
        this.setupRetryInterceptor();
    }

    /**
     * Retry interceptor'ını yapılandırır
     */
    private setupRetryInterceptor(): void {
        // Add retry config to each request
        this.client.interceptors.request.use((config: RetryConfig) => {
            config.retry = true;
            config.currentRetryCount = config.currentRetryCount ?? 0;
            return config;
        });

        // Setup response interceptor for automatic retries
        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const config = error.config as RetryConfig;
                
                // Retry yapılandırması yoksa veya istek zaten yeniden denenmişse, hatayı fırlat
                if (!config || !config.retry) {
                    return Promise.reject(error);
                }
                
                // Retry sayacını başlat
                config.currentRetryCount = config.currentRetryCount ?? 0;
                
                // Maksimum retry sayısına ulaşıldıysa, hatayı fırlat
                if (config.currentRetryCount >= this.MAX_RETRIES) {
                    logger.error(`[${this.constructor.name}] Maximum retries (${this.MAX_RETRIES}) reached for ${config.url}`);
                    return Promise.reject(error);
                }
                
                // Retry sayacını artır
                config.currentRetryCount += 1;
                
                // Exponential backoff ile bekleme süresi hesapla
                const delayTime = Math.min(
                    this.MAX_RETRY_DELAY,
                    this.RETRY_DELAY * Math.pow(2, config.currentRetryCount - 1)
                );
                
                logger.warn(`[${this.constructor.name}] Retry attempt ${config.currentRetryCount}/${this.MAX_RETRIES} for ${config.url} after ${delayTime}ms`);
                
                // Belirtilen süre kadar bekle
                await new Promise(resolve => setTimeout(resolve, delayTime));
                
                // İsteği yeniden dene - axios instance'ı direkt olarak kullanmak yerine, yeni bir istek oluşturalım
                try {
                    const retryConfig = { ...config };
                    return this.client(retryConfig);
                } catch (retryError) {
                    return Promise.reject(retryError);
                }
            }
        );
    }

    /**
     * Herhangi bir asenkron operasyon için yeniden deneme sağlayan yardımcı metot
     * @param operation Yeniden denenecek asenkron işlem
     * @param fallback Tüm denemeler başarısız olursa dönülecek değer
     * @param operationName İşlemin adı (loglama için)
     */
    protected async retryOperation<T>(
        operation: () => Promise<T>, 
        fallback: T, 
        operationName: string
    ): Promise<T> {
        let lastError: any = null;
        
        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                if (attempt === this.MAX_RETRIES) {
                    logger.error(`[${this.constructor.name}] ${operationName} failed after ${this.MAX_RETRIES} attempts:`, error);
                    break;
                }
                
                const delayTime = Math.min(
                    this.MAX_RETRY_DELAY,
                    this.RETRY_DELAY * Math.pow(2, attempt - 1)
                );
                
                logger.warn(`[${this.constructor.name}] ${operationName} failed on attempt ${attempt}/${this.MAX_RETRIES}, retrying after ${delayTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, delayTime));
            }
        }
        
        return fallback;
    }

    /**
     * Verilen URL'ye zaman aşımı korumalı bir fetch isteği yapar
     * @param url İstek yapılacak URL
     * @param timeout Zaman aşımı süresi (ms)
     */
    protected async fetchWithTimeout(url: string, timeout: number = 10000): Promise<Response> {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                signal: controller.signal
            });
            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            throw error;
        }
    }

    /**
     * İstemcinin kullandığı ağı döndürür
     */
    public getNetwork(): Network {
        return this.network;
    }

    /**
     * Websocket endpoint URL'sini döndürür
     */
    public getWsEndpoint(): string {
        return this.wsEndpoint;
    }

    /**
     * API base URL'sini döndürür
     */
    public getBaseUrl(): string {
        return this.baseUrl;
    }

    /**
     * RPC base URL'sini döndürür
     */
    public getRpcUrl(): string {
        return this.baseRpcUrl;
    }
} 