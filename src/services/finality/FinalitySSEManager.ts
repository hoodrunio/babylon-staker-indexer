import { Response } from 'express';
import { BlockSignatureInfo, SignatureStatsParams } from '../../types';
import { Network } from '../../api/middleware/network-selector';

export class FinalitySSEManager {
    private static instance: FinalitySSEManager | null = null;
    private sseClients: Map<string, { res: Response; fpBtcPkHex: string; initialDataSent?: boolean }> = new Map();
    private readonly SSE_RETRY_INTERVAL = 3000;
    private readonly DEFAULT_LAST_N_BLOCKS = 101;

    private constructor() {}

    public static getInstance(): FinalitySSEManager {
        if (!FinalitySSEManager.instance) {
            FinalitySSEManager.instance = new FinalitySSEManager();
        }
        return FinalitySSEManager.instance;
    }

    public getClients(): Map<string, { res: Response; fpBtcPkHex: string; initialDataSent?: boolean }> {
        return this.sseClients;
    }

    public addClient(
        clientId: string, 
        res: Response, 
        fpBtcPkHex: string,
        getSignatureStats: (params: SignatureStatsParams) => Promise<any>
    ): void {
        // SSE header settings
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
            'X-Accel-Buffering': 'no' // Disable Nginx buffering
        });

        // Set retry interval
        res.write(`retry: ${this.SSE_RETRY_INTERVAL}\n\n`);

        // Save client
        this.sseClients.set(clientId, { res, fpBtcPkHex, initialDataSent: false });

        // Send initial data - last 100 blocks
        this.sendInitialData(clientId, getSignatureStats);

        // Cleanup on client disconnect
        res.on('close', () => {
            console.log(`[SSE] Client disconnected: ${clientId}`);
            this.sseClients.delete(clientId);
        });
    }

    private async sendInitialData(
        clientId: string,
        getSignatureStats: (params: SignatureStatsParams) => Promise<any>
    ): Promise<void> {
        const client = this.sseClients.get(clientId);
        if (!client || client.initialDataSent) return;

        try {
            const stats = await getSignatureStats({
                fpBtcPkHex: client.fpBtcPkHex,
                lastNBlocks: this.DEFAULT_LAST_N_BLOCKS,
                network: Network.MAINNET
            });

            this.sendEvent(clientId, 'initial', stats);
            client.initialDataSent = true;
        } catch (error) {
            console.error(`[SSE] Error sending initial data to client ${clientId}:`, error);
        }
    }

    private sendEvent(clientId: string, event: string, data: any): void {
        const client = this.sseClients.get(clientId);
        if (!client) return;

        try {
            client.res.write(`event: ${event}\n`);
            client.res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error(`[SSE] Error sending event to client ${clientId}:`, error);
            this.sseClients.delete(clientId);
        }
    }

    public broadcastBlock(blockInfo: BlockSignatureInfo): void {
        const sentClients = new Set<string>();
        
        for (const [clientId, client] of this.sseClients.entries()) {
            if (sentClients.has(clientId)) continue;
            
            try {
                this.sendEvent(clientId, 'block', blockInfo);
                sentClients.add(clientId);
            } catch (error) {
                console.error(`[SSE] Error broadcasting to client ${clientId}:`, error);
            }
        }
    }

    public getClientCount(): number {
        return this.sseClients.size;
    }

    public hasClient(clientId: string): boolean {
        return this.sseClients.has(clientId);
    }

    public getClientFpBtcPkHex(clientId: string): string | undefined {
        return this.sseClients.get(clientId)?.fpBtcPkHex;
    }
} 