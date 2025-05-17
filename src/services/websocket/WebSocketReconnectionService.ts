import { logger } from '../../utils/logger';
import { BabylonClient } from '../../clients/BabylonClient';
import { WebsocketHealthTracker } from '../btc-delegations/WebsocketHealthTracker';

// WebSocket Reconnection Service
export class WebSocketReconnectionService {
    private static instance: WebSocketReconnectionService | null = null;
    private reconnectAttempts: number = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private readonly RECONNECT_INTERVAL = 5000; // 5 seconds
    
    private constructor(private healthTracker: WebsocketHealthTracker) {}
    
    public static getInstance(): WebSocketReconnectionService {
        if (!WebSocketReconnectionService.instance) {
            const healthTracker = WebsocketHealthTracker.getInstance();
            WebSocketReconnectionService.instance = new WebSocketReconnectionService(healthTracker);
        }
        return WebSocketReconnectionService.instance;
    }
    
    public async handleReconnect(
        client: BabylonClient | undefined,
        reconnectAction: () => void
    ): Promise<void> {
        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            logger.info(`Attempting to reconnect (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);
            
            try {
                if (client) {
                    await this.healthTracker.handleReconnection(client);
                }

                setTimeout(reconnectAction, this.RECONNECT_INTERVAL);
            } catch (error) {
                logger.error(`Error handling reconnection:`, error);
                // Retry even if there's an error
                this.handleReconnect(client, reconnectAction);
            }
        } else {
            logger.error(`Max reconnection attempts reached`);
            this.reconnectAttempts = 0; // Reset attempts for future reconnections
        }
    }
    
    public resetAttempts(): void {
        this.reconnectAttempts = 0;
    }
} 