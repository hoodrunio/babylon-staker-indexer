import { FinalityEpochService } from '../../../services/finality/FinalityEpochService';
import { FinalitySignatureService } from '../../../services/finality/FinalitySignatureService';
import { Network } from '../../../types/finality';
import { Router, Request, Response } from 'express';
import { logger } from '../../../utils/logger';

export class FinalityEpochController {
    private static instance: FinalityEpochController | null = null;
    private finalityEpochService: FinalityEpochService;
    private finalitySignatureService: FinalitySignatureService;

    private constructor() {
        this.finalityEpochService = FinalityEpochService.getInstance();
        this.finalitySignatureService = FinalitySignatureService.getInstance();
    }

    public static getInstance(): FinalityEpochController {
        if (!FinalityEpochController.instance) {
            FinalityEpochController.instance = new FinalityEpochController();
        }
        return FinalityEpochController.instance;
    }

    /**
     * Register epoch routes on the provided router
     * @param router Express router
     */
    public registerRoutes(router: Router): void {
        // Get current epoch
        router.get('/epoch/current', this.getCurrentEpoch.bind(this));
        
        // Get current epoch statistics
        router.get('/epoch/current/stats', this.getCurrentEpochStats.bind(this));
        
        // Get current epoch statistics for a specific provider
        router.get('/epoch/current/stats/:fpBtcPkHex', this.getProviderCurrentEpochStats.bind(this));
    }

    /**
     * Get current finality epoch
     */
    public async getCurrentEpoch(req: Request, res: Response): Promise<Response> {
        try {
            const epoch = await this.finalityEpochService.getCurrentEpochInfo();
            
            return res.json(epoch);
        } catch (error) {
            logger.error('Error getting current epoch:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    
    /**
     * Get current epoch statistics
     */
    public async getCurrentEpochStats(req: Request, res: Response): Promise<Response> {
        try {
            const stats = await this.finalityEpochService.getCurrentEpochStats();
            
            return res.json(stats);
        } catch (error) {
            logger.error('Error getting current epoch stats:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    
    /**
     * Get current epoch statistics for a specific provider
     */
    public async getProviderCurrentEpochStats(req: Request, res: Response): Promise<Response> {
        try {
            const { fpBtcPkHex } = req.params;
            const network = req.network || Network.MAINNET;
            const stats = await this.finalityEpochService.getProviderCurrentEpochStats(
                fpBtcPkHex, 
                this.finalitySignatureService.getSignatureStats.bind(this.finalitySignatureService), 
                network
            );
            
            return res.json(stats);
        } catch (error) {
            logger.error('Error getting current epoch stats for provider:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
