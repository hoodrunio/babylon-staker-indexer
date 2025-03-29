import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosRequestHeaders } from 'axios';
import { Network } from '../types/finality';
import { logger } from '../utils/logger';

// add an interface for custom error types
export interface CustomError extends Error {
    originalError?: any;
}

export interface RetryConfig extends InternalAxiosRequestConfig {
    retry?: boolean;
    currentRetryCount?: number;
}

/**
 * Base class for different API clients.
 * Provides HTTP requests, retry logic, and network configuration.
 */
export abstract class BaseClient {
    protected readonly client: AxiosInstance;
    protected readonly network: Network;
    protected readonly baseUrl: string;
    protected readonly baseRpcUrl: string;
    protected readonly wsEndpoint: string;
    protected readonly MAX_RETRIES = 3;
    protected readonly RETRY_DELAY = 2000; // 2 seconds
    protected readonly MAX_RETRY_DELAY = 5000; // 5 seconds

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
     * Configures the retry interceptor
     */
    private setupRetryInterceptor(): void {
        // Add retry config to each request
        this.client.interceptors.request.use((config: RetryConfig) => {
            // Only set retry if not explicitly set
            if (config.retry === undefined) {
                config.retry = true;
            }
            config.currentRetryCount = config.currentRetryCount ?? 0;
            return config;
        });

        // Setup response interceptor for automatic retries
        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const config = error.config as RetryConfig;

                // If retry is explicitly disabled or request already retried, reject the error
                if (config.retry === false || !config.retry) {
                    return Promise.reject(error);
                }

                // Check for specific error messages where we don't want to retry
                if (error.response?.data?.message && typeof error.response.data.message === 'string') {
                    const errorMessage = error.response.data.message;
                    
                    // Don't retry for "Missing export query" errors
                    if (errorMessage.includes('Missing export query')) {
                        return Promise.reject(error);
                    }
                    
                    // Don't retry for "unknown variant" errors (these are expected for query extraction)
                    if (errorMessage.includes('unknown variant') && 
                        (errorMessage.includes('expected one of') || errorMessage.includes('expected `'))) {
                        return Promise.reject(error);
                    }
                }

                // Check for specific error conditions where we shouldn't retry with the same URL
                // For transactions not found error
                if (error.response?.data?.message && 
                    typeof error.response.data.message === 'string' &&
                    error.response.data.message.includes('tx not found')) {
                    
                    // Create a special error for transaction not found
                    const txNotFoundError: CustomError = new Error('SPECIAL_ERROR_TX_NOT_FOUND');
                    txNotFoundError.name = 'TxNotFoundError';
                    txNotFoundError.originalError = error;
                    return Promise.reject(txNotFoundError);
                }
                
                // For blocks with height not available error
                if (error.response?.data?.error?.data && 
                    typeof error.response.data.error.data === 'string' &&
                    error.response.data.error.data.includes('height') && 
                    error.response.data.error.data.includes('is not available')) {
                    
                    // Create a special error for height not available
                    const heightNotAvailableError: CustomError = new Error('SPECIAL_ERROR_HEIGHT_NOT_AVAILABLE');
                    heightNotAvailableError.name = 'HeightNotAvailableError';
                    heightNotAvailableError.originalError = error;
                    return Promise.reject(heightNotAvailableError);
                }
                
                // For blocks with height greater than current blockchain height
                if (error.response?.data?.error?.data && 
                    typeof error.response.data.error.data === 'string' &&
                    error.response.data.error.data.includes('height') && 
                    error.response.data.error.data.includes('must be less than or equal to the current blockchain height')) {
                    
                    // Create a special error for height greater than current blockchain height
                    const heightNotAvailableError: CustomError = new Error('SPECIAL_ERROR_HEIGHT_NOT_AVAILABLE');
                    heightNotAvailableError.name = 'HeightNotAvailableError';
                    heightNotAvailableError.originalError = error;
                    return Promise.reject(heightNotAvailableError);
                }
                
                // For invalid Hex format errors (odd length hex string, invalid byte)
                if (error.response?.data?.message && 
                    typeof error.response.data.message === 'string' &&
                    (error.response.data.message.includes('odd length hex string') ||
                     error.response.data.message.includes('invalid byte'))) {
                        
                    // For these types of errors, not retry at all, directly throw the error
                    logger.warn(`[${this.constructor.name}] Invalid hex format error, not retrying: ${error.response.data.message}`);
                    
                    // Create a special error
                    const invalidHexError: CustomError = new Error('INVALID_HEX_FORMAT');
                    invalidHexError.name = 'InvalidHexFormatError';
                    invalidHexError.originalError = error;
                    return Promise.reject(invalidHexError);
                }

                // Initialize retry counter
                config.currentRetryCount = config.currentRetryCount ?? 0;

                // If maximum retries reached, reject the error
                if (config.currentRetryCount >= this.MAX_RETRIES) {
                    logger.error(`[${this.constructor.name}] Maximum retries (${this.MAX_RETRIES}) reached for ${config.url}`);
                    return Promise.reject(error);
                }

                // Increment retry counter
                config.currentRetryCount += 1;

                // Calculate wait time with exponential backoff
                const delayTime = Math.min(
                    this.MAX_RETRY_DELAY,
                    this.RETRY_DELAY * Math.pow(2, config.currentRetryCount - 1)
                );

                logger.warn(`[${this.constructor.name}] Retry attempt ${config.currentRetryCount}/${this.MAX_RETRIES} for ${config.url} after ${delayTime}ms`);

                // Wait for the specified time
                await new Promise(resolve => setTimeout(resolve, delayTime));

                // Retry the request - create a new request instead of using the axios instance directly
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
     * Helper method that provides retry functionality for any asynchronous operation
     * @param operation Asynchronous operation to retry
     * @param fallback Value to return if all attempts fail
     * @param operationName Name of the operation (for logging)
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
     * Makes a timeout-protected fetch request to the given URL
     * @param url URL to request
     * @param timeout Timeout duration (ms)
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
     * Returns the network used by the client
     */
    public getNetwork(): Network {
        return this.network;
    }

    /**
     * Returns the WebSocket endpoint URL
     */
    public getWsEndpoint(): string {
        return this.wsEndpoint;
    }

    /**
     * Returns the API base URL
     */
    public getBaseUrl(): string {
        return this.baseUrl;
    }

    /**
     * Returns the RPC base URL
     */
    public getRpcUrl(): string {
        return this.baseRpcUrl;
    }

    protected createRequestConfig(retry?: boolean): RetryConfig {
        return {
            retry: retry ?? true,
            headers: this.client.defaults.headers as unknown as AxiosRequestHeaders
        } as RetryConfig;
    }
}