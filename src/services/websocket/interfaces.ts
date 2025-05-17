import WebSocket from 'ws';
import { BabylonClient } from '../../clients/BabylonClient';

// Event handler interface for all event handlers to implement
export interface IEventHandler {
    handleEvent(data: any): Promise<void>;
}

// WebSocket connection interface
export interface IWebSocketConnection {
    connect(): void;
    disconnect(): void;
    isConnected(): boolean;
    send(message: any): void;
}

// Subscription interface
export interface ISubscription {
    getId(): string;
    getQuery(): string;
}

// WebSocket configuration interface
export interface IWebSocketConfig {
    getWsUrl(): string | undefined;
    getClient(): BabylonClient | undefined;
}

// WebSocket factory interface
export interface IWebSocketFactory {
    createWebSocket(url: string): WebSocket;
}

// Message processor interface
export interface IMessageProcessor {
    canProcess(message: any): boolean;
    process(message: any): Promise<void>;
}

// WebSocket event handlers interface
export interface IWebSocketEventHandlers {
    onOpen: () => Promise<void>;
    onMessage: (data: Buffer) => Promise<void>;
    onClose: () => Promise<void>;
    onError: (error: Error) => void;
} 