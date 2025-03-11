import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Network } from '../types/finality';
import { logger } from '../utils/logger';

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
     * Configures the retry interceptor
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

                // If there is no retry configuration or the request has already been retried, throw the error
                if (!config || !config.retry) {
                    return Promise.reject(error);
                }

                // Add check for transaction not found error
                if (error.response && error.response.data && config.url) {
                    // Tx not found error check
                    if (config.url.includes('/cosmos/tx/v1beta1/txs/') &&
                        error.response.data.message &&
                        error.response.data.message.includes('tx not found')) {

                        logger.warn(`[${this.constructor.name}] Transaction not found for ${config.url}, need to try another endpoint`);

                        // Throw transaction not found error with custom error message
                        error.isNotFoundError = true;
                        error.needsEndpointRotation = true;
                        return Promise.reject(error);
                    }

                    // Block not found error check
                    if (config.url.includes('/block?height=') &&
                        error.response.data.error &&
                        error.response.data.error.data &&
                        error.response.data.error.data.includes('height') &&
                        error.response.data.error.data.includes('is not available')) {

                        logger.warn(`[${this.constructor.name}] Block height is not available for ${config.url}, need to try another endpoint`);

                        // Throw block not found error with custom error message
                        error.isNotFoundError = true;
                        error.needsEndpointRotation = true;
                        return Promise.reject(error);
                    }
                }

                // Initialize retry counter
                config.currentRetryCount = config.currentRetryCount ?? 0;

                // If the maximum number of retries has been reached, throw the error
                if (config.currentRetryCount >= this.MAX_RETRIES) {
                    logger.error(`[${this.constructor.name}] Maximum retries (${this.MAX_RETRIES}) reached for ${config.url}`);
                    return Promise.reject(error);
                }

                // Increment retry counter
                config.currentRetryCount += 1;

                // Calculate waiting time with exponential backoff
                const delayTime = Math.min(
                    this.MAX_RETRY_DELAY,
                    this.RETRY_DELAY * Math.pow(2, config.currentRetryCount - 1)
                );

                logger.warn(`[${this.constructor.name}] Retry attempt ${config.currentRetryCount}/${this.MAX_RETRIES} for ${config.url} after ${delayTime}ms`);

                // Wait for the specified amount of time
                await new Promise(resolve => setTimeout(resolve, delayTime));

                // Retry the request - instead of using the axios instance directly, let's create a new request
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
     * Helper method that provides retry for any asynchronous operation
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
     * Makes a fetch request to the given URL with timeout protection
     * @param url URL to make the request to
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
     * Returns the network the client is using
     */
    public getNetwork(): Network {
        return this.network;
    }

    /**
     * Returns the websocket endpoint URL
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
}