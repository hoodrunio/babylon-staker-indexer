export class RateLimiter {
    private queue: Map<string, number> = new Map();
    private processing: Map<string, boolean> = new Map();
    private readonly requestsPerInterval: number;
    private readonly intervalMs: number;

    constructor(requestsPerInterval: number = 5, intervalMs: number = 1000) {
        this.requestsPerInterval = requestsPerInterval;
        this.intervalMs = intervalMs;
    }

    public async acquire(key: string): Promise<boolean> {
        if (this.processing.get(key)) {
            return false;
        }

        const now = Date.now();
        const lastRequest = this.queue.get(key) || 0;

        if (now - lastRequest < this.intervalMs) {
            return false;
        }

        this.processing.set(key, true);
        this.queue.set(key, now);

        await new Promise(resolve => setTimeout(resolve, this.intervalMs / this.requestsPerInterval));

        this.processing.set(key, false);
        return true;
    }
}