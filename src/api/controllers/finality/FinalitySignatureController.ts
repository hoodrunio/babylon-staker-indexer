import { FinalitySignatureService } from '../../../services/finality/FinalitySignatureService';
import { Network } from '../../../types/finality';
import { Router, Request, Response } from 'express';
import { logger } from '../../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class FinalitySignatureController {
    private static instance: FinalitySignatureController | null = null;
    private finalitySignatureService: FinalitySignatureService;

    private constructor() {
        this.finalitySignatureService = FinalitySignatureService.getInstance();
    }

    public static getInstance(): FinalitySignatureController {
        if (!FinalitySignatureController.instance) {
            FinalitySignatureController.instance = new FinalitySignatureController();
        }
        return FinalitySignatureController.instance;
    }

    /**
     * Register signature routes on the provided router
     * @param router Express router
     */
    public registerRoutes(router: Router): void {
        // Get signature stats for a finality provider
        router.get('/signatures/:fpBtcPkHex/stats', this.getSignatureStats.bind(this));
        
        // Get historical performance stats for a finality provider
        router.get('/signatures/:fpBtcPkHex/performance', this.getPerformanceStats.bind(this));
        
        // SSE endpoint for real-time signature updates
        router.get('/signatures/:fpBtcPkHex/stream', this.getSignatureStream.bind(this));
    }

    /**
     * Get signature stats for a finality provider
     */
    public async getSignatureStats(req: Request, res: Response): Promise<Response> {
        try {
            const { fpBtcPkHex } = req.params;
            const network = req.network || Network.MAINNET;
            const DEFAULT_BLOCKS = 100; // Statistics for last 100 blocks

            const currentHeight = await this.finalitySignatureService.getCurrentHeight();
            const startHeight = Math.max(1, currentHeight - DEFAULT_BLOCKS);
            
            const stats = await this.finalitySignatureService.getSignatureStats({ 
                fpBtcPkHex, 
                startHeight,
                endHeight: currentHeight,
                network
            });

            return res.json(stats);
        } catch (error) {
            logger.error('Error getting signature stats:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get historical performance stats for a finality provider
     */
    public async getPerformanceStats(req: Request, res: Response): Promise<Response> {
        try {
            const { fpBtcPkHex } = req.params;
            const network = req.network || Network.MAINNET;
            const currentHeight = await this.finalitySignatureService.getCurrentHeight();
            const lookbackBlocks = 5000; // Last 5000 blocks

            // Get statistics for the last 5000 blocks
            const startHeight = Math.max(1, currentHeight - lookbackBlocks + 1);
            const stats = await this.finalitySignatureService.getSignatureStats({ 
                fpBtcPkHex, 
                startHeight: startHeight,
                endHeight: currentHeight,
                network
            });

            // Calculate performance metrics
            const totalBlocks = currentHeight - startHeight + 1; // Actual total block count
            const signableBlocks = stats.signedBlocks + stats.missedBlocks; // Signable blocks
            const successRate = signableBlocks > 0 ? (stats.signedBlocks / signableBlocks) * 100 : 0;

            // Calculate unknown blocks
            const unknownBlocks = totalBlocks - signableBlocks;

            return res.json({
                overall_performance: {
                    signed: `${stats.signedBlocks} / ${signableBlocks}`,
                    missed: stats.missedBlocks,
                    success_rate: `${successRate.toFixed(2)}`,
                    block_range: `${startHeight} - ${currentHeight}`,
                    total_blocks: totalBlocks,
                    signable_blocks: signableBlocks,
                    unknown_blocks: unknownBlocks,
                    lookback_blocks: lookbackBlocks
                },
                details: {
                    signed_blocks: stats.signedBlocks,
                    missed_blocks: stats.missedBlocks,
                    unknown_blocks: unknownBlocks,
                    total_blocks: totalBlocks,
                    signable_blocks: signableBlocks,
                    valid_blocks: signableBlocks,
                    success_rate: successRate,
                    start_height: startHeight,
                    end_height: currentHeight,
                    lookback_blocks: lookbackBlocks,
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            logger.error('Error getting performance stats:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * SSE endpoint for real-time signature updates
     */
    public async getSignatureStream(req: Request, res: Response): Promise<void> {
        try {
            const { fpBtcPkHex } = req.params;
            const clientId = uuidv4();

            logger.info(`[SSE] New client connected: ${clientId} for FP: ${fpBtcPkHex}`);

            // Start SSE connection
            await this.finalitySignatureService.addSSEClient(
                clientId, 
                res, 
                fpBtcPkHex
            );

            // Clean up when client connection is closed
            req.on('close', () => {
                logger.info(`[SSE] Client connection closed: ${clientId}`);
            });
        } catch (error) {
            logger.error('[SSE] Error setting up SSE connection:', error);
            res.status(500).end();
        }
    }
}
