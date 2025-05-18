import { FinalityEpochService } from '../../../services/finality/FinalityEpochService';
import { Network } from '../../../types/finality';
import { Router, Request, Response } from 'express';
import { logger } from '../../../utils/logger';

export class FinalityEpochController {
    private static instance: FinalityEpochController | null = null;
    private finalityEpochService: FinalityEpochService;

    private constructor() {
        this.finalityEpochService = FinalityEpochService.getInstance();
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
    }

    /**
     * Get current finality epoch
     */
    public async getCurrentEpoch(req: Request, res: Response): Promise<Response> {
        try {
            const network = req.network || Network.MAINNET;
            const epoch = await this.finalityEpochService.getCurrentEpochInfo(network);
            
            return res.json(epoch);
        } catch (error) {
            logger.error('Error getting current epoch:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
