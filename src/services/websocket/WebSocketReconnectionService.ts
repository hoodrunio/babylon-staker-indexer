import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { BabylonClient } from '../../clients/BabylonClient';
import { WebsocketHealthTracker } from '../btc-delegations/WebsocketHealthTracker';

// WebSocket Reconnection Service
export class WebSocketReconnectionService {
    private static instance: WebSocketReconnectionService | null = null;
    private reconnectAttempts: Map<Network, number> = new Map();
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
        network: Network, 
        client: BabylonClient | undefined,
        reconnectAction: () => void
    ): Promise<void> {
        const attempts = this.reconnectAttempts.get(network) || 0;
        
        if (attempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts.set(network, attempts + 1);
            logger.info(`[${network}] Attempting to reconnect (attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
            
            try {
                if (client) {
                    await this.healthTracker.handleReconnection(network, client);
                }

                setTimeout(reconnectAction, this.RECONNECT_INTERVAL);
            } catch (error) {
                logger.error(`[${network}] Error handling reconnection:`, error);
                // Retry even if there's an error
                this.handleReconnect(network, client, reconnectAction);
            }
        } else {
            logger.error(`[${network}] Max reconnection attempts reached`);
            this.reconnectAttempts.set(network, 0); // Reset attempts for future reconnections
        }
    }
    
    public resetAttempts(network: Network): void {
        this.reconnectAttempts.set(network, 0);
    }
} 