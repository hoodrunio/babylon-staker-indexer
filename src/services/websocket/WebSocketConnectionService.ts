import WebSocket from 'ws';
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
        private webSocketFactory: IWebSocketFactory,
        private eventHandlers: IWebSocketEventHandlers
    ) {}

    connect(): void {
        if (this.ws) return;

        try {
            this.ws = this.webSocketFactory.createWebSocket(this.url);
            
            this.ws.on('open', async () => {
                this.connected = true;
                await this.eventHandlers.onOpen();
            });
            
            this.ws.on('message', async (data: Buffer) => {
                await this.eventHandlers.onMessage(data);
            });
            
            this.ws.on('close', async () => {
                this.connected = false;
                await this.eventHandlers.onClose();
            });
            
            this.ws.on('error', (error: Error) => {
                this.eventHandlers.onError(error);
            });
        } catch (error) {
            logger.error(`Error creating WebSocket connection:`, error);
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
            logger.warn(`Attempted to send message but WebSocket is not connected`);
        }
    }
}

// WebSocket Connection Service
export class WebSocketConnectionService {
    private static instance: WebSocketConnectionService | null = null;
    private connection: IWebSocketConnection | null = null;
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
        eventHandlers: IWebSocketEventHandlers
    ): IWebSocketConnection {
        // Close any existing connection first
        if (this.connection) {
            this.connection.disconnect();
        }
        
        const connection = new WebSocketConnection(
            url,
            this.webSocketFactory,
            eventHandlers
        );
        
        this.connection = connection;
        return connection;
    }
    
    public getConnection(): IWebSocketConnection | null {
        return this.connection;
    }
    
    public removeConnection(): void {
        if (this.connection) {
            this.connection.disconnect();
            this.connection = null;
        }
    }
    
    public disconnectAll(): void {
        if (this.connection) {
            this.connection.disconnect();
            this.connection = null;
        }
    }
} 