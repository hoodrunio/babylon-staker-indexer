import WebSocket from 'ws';
import { Network } from '../../types/finality';
import { logger } from '../../utils/logger';
import { 
    IWebSocketConnection, 
    IWebSocketFactory, 
    IWebSocketEventHandlers 
} from './interfaces';

// Basic WebSocket factory implementation
export class DefaultWebSocketFactory implements IWebSocketFactory {
    createWebSocket(url: string): WebSocket {
        return new WebSocket(url);
    }
}

// WebSocket connection implementation
export class WebSocketConnection implements IWebSocketConnection {
    private ws: WebSocket | null = null;
    private connected = false;

    constructor(
        private url: string,
        private network: Network,
        private webSocketFactory: IWebSocketFactory,
        private eventHandlers: IWebSocketEventHandlers
    ) {}

    connect(): void {
        if (this.ws) return;

        try {
            this.ws = this.webSocketFactory.createWebSocket(this.url);
            
            this.ws.on('open', async () => {
                this.connected = true;
                await this.eventHandlers.onOpen(this.network);
            });
            
            this.ws.on('message', async (data: Buffer) => {
                await this.eventHandlers.onMessage(data, this.network);
            });
            
            this.ws.on('close', async () => {
                this.connected = false;
                await this.eventHandlers.onClose(this.network);
            });
            
            this.ws.on('error', (error: Error) => {
                this.eventHandlers.onError(error, this.network);
            });
        } catch (error) {
            logger.error(`Error creating WebSocket for ${this.network}:`, error);
            throw error;
        }
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.connected = false;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    send(message: any): void {
        if (this.ws && this.connected) {
            this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
        } else {
            logger.warn(`Attempted to send message to ${this.network} but not connected`);
        }
    }
}

// WebSocket Connection Service
export class WebSocketConnectionService {
    private static instance: WebSocketConnectionService | null = null;
    private connections: Map<Network, IWebSocketConnection> = new Map();
    private webSocketFactory: IWebSocketFactory;
    
    private constructor() {
        this.webSocketFactory = new DefaultWebSocketFactory();
    }
    
    public static getInstance(): WebSocketConnectionService {
        if (!WebSocketConnectionService.instance) {
            WebSocketConnectionService.instance = new WebSocketConnectionService();
        }
        return WebSocketConnectionService.instance;
    }
    
    public createConnection(
        url: string,
        network: Network,
        eventHandlers: IWebSocketEventHandlers
    ): IWebSocketConnection {
        const connection = new WebSocketConnection(
            url,
            network,
            this.webSocketFactory,
            eventHandlers
        );
        
        this.connections.set(network, connection);
        return connection;
    }
    
    public getConnection(network: Network): IWebSocketConnection | undefined {
        return this.connections.get(network);
    }
    
    public removeConnection(network: Network): void {
        const connection = this.connections.get(network);
        if (connection) {
            connection.disconnect();
            this.connections.delete(network);
        }
    }
    
    public disconnectAll(): void {
        for (const connection of this.connections.values()) {
            connection.disconnect();
        }
        this.connections.clear();
    }
} 