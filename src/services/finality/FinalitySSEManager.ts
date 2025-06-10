import { Response } from 'express';
import { BlockSignatureInfo, SignatureStatsParams } from '../../types';
import { logger } from '../../utils/logger';
import { BabylonClient } from '../../clients/BabylonClient';

export class FinalitySSEManager {
    private static instance: FinalitySSEManager | null = null;
    private sseClients: Map<string, { 
        res: Response; 
        fpBtcPkHex: string; 
        initialDataSent?: boolean;
        lastSentBlockHeight?: number;
    }> = new Map();
    private readonly SSE_RETRY_INTERVAL = 3000;
    private readonly DEFAULT_LAST_N_BLOCKS = 100;

    private constructor() {}

    public static getInstance(): FinalitySSEManager {
        if (!FinalitySSEManager.instance) {
            FinalitySSEManager.instance = new FinalitySSEManager();
        }
        return FinalitySSEManager.instance;
    }

    public getClients(): Map<string, { 
        res: Response; 
        fpBtcPkHex: string; 
        initialDataSent?: boolean;
        lastSentBlockHeight?: number;
    }> {
        return this.sseClients;
    }

    public async addClient(
        clientId: string, 
        res: Response, 
        fpBtcPkHex: string,
        getSignatureStats: (params: SignatureStatsParams) => Promise<any>,
        currentHeight: number
    ): Promise<void> {
        logger.info(`[SSE] Adding new client ${clientId}`);
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

        // Save client with all required fields
        this.sseClients.set(clientId, { 
            res, 
            fpBtcPkHex, 
            initialDataSent: false,
            lastSentBlockHeight: undefined 
        });

        // Send initial data - last 100 blocks
        await this.sendInitialData(clientId, getSignatureStats, currentHeight);

        // Cleanup on client disconnect
        res.on('close', () => {
            logger.info(`[SSE] Client disconnected: ${clientId}`);
            this.sseClients.delete(clientId);
        });
    }

    private async sendInitialData(
        clientId: string,
        getSignatureStats: (params: SignatureStatsParams) => Promise<any>,
        currentHeight: number
    ): Promise<void> {
        logger.info(`[SSE] Attempting to send initial data for client ${clientId}`);
        const client = this.sseClients.get(clientId); 
        
        if (!client) {
            logger.info(`[SSE] Client ${clientId} not found`);
            return;
        }
        
        if (client.initialDataSent) {
            logger.info(`[SSE] Initial data already sent for client ${clientId}`);
            return;
        }

        try {
            logger.info(`[SSE] Current height: ${currentHeight}`);
            // Calculate safe height (2 blocks behind)
            const safeHeight = currentHeight - 2;
            const startHeight = Math.max(1, safeHeight - this.DEFAULT_LAST_N_BLOCKS + 1);
            
            // Use the single configured network from BabylonClient
            const babylonClient = BabylonClient.getInstance();
            const network = babylonClient.getNetwork();
            logger.info(`[SSE] Using network ${network} for client ${clientId}`);
            
            logger.info(`[SSE] Fetching stats for height range: ${startHeight} - ${safeHeight} on network ${network}`);
            const stats = await getSignatureStats({
                fpBtcPkHex: client.fpBtcPkHex,
                startHeight,
                endHeight: safeHeight,
                network
            });

            logger.info(`[SSE] Got stats, sending initial event to client ${clientId}`);
            this.sendEvent(clientId, 'initial', stats);
            client.initialDataSent = true;
            client.lastSentBlockHeight = safeHeight;
        } catch (error) {
            logger.error(`[SSE] Error sending initial data to client ${clientId}: ${error instanceof Error ? error.message : String(error)}`);
            // Send the error to the client
            this.sendEvent(clientId, 'error', { message: `Error fetching data: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    private sendEvent(clientId: string, event: string, data: any): void {
        const client = this.sseClients.get(clientId);
        if (!client) return;

        try {
            client.res.write(`event: ${event}\n`);
            client.res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            logger.error(`[SSE] Error sending event to client ${clientId}:`, error);
            this.sseClients.delete(clientId);
        }
    }

    public broadcastBlock(blockInfo: BlockSignatureInfo): void {
        for (const [clientId, client] of this.sseClients.entries()) {
            try {
                // Skip if we've already sent this block height to this client
                if (client.lastSentBlockHeight && client.lastSentBlockHeight >= blockInfo.height) {
                    continue;
                }
                
                this.sendEvent(clientId, 'block', blockInfo);
                client.lastSentBlockHeight = blockInfo.height;
            } catch (error) {
                logger.error(`[SSE] Error broadcasting to client ${clientId}:`, error);
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