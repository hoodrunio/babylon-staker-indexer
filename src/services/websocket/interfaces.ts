import WebSocket from 'ws';
import { Network } from '../../types/finality';
import { BabylonClient } from '../../clients/BabylonClient';

// Event handler interface for all event handlers to implement
export interface IEventHandler {
    handleEvent(data: any, network: Network): Promise<void>;
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

// Network configuration interface
export interface INetworkConfig {
    getNetwork(): Network;
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
    process(message: any, network: Network): Promise<void>;
}

// WebSocket event handlers interface
export interface IWebSocketEventHandlers {
    onOpen: (network: Network) => Promise<void>;
    onMessage: (data: Buffer, network: Network) => Promise<void>;
    onClose: (network: Network) => Promise<void>;
    onError: (error: Error, network: Network) => void;
} 