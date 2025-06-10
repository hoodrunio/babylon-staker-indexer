import { WebSocketOrchestratorService } from './websocket/WebSocketOrchestratorService';

/**
 * Main WebsocketService - Facade for the underlying WebSocket services hierarchy
 * This maintains backward compatibility with the rest of the application
 */
export class WebsocketService {
    private static instance: WebsocketService | null = null;
    private orchestrator: WebSocketOrchestratorService;
    
    private constructor() {
        this.orchestrator = WebSocketOrchestratorService.getInstance();
    }
    
    public static getInstance(): WebsocketService {
        if (!WebsocketService.instance) {
            WebsocketService.instance = new WebsocketService();
        }
        return WebsocketService.instance;
    }
    
    public startListening(): void {
        this.orchestrator.startListening();
    }
    
    public stop(): void {
        this.orchestrator.stop();
    }
} 