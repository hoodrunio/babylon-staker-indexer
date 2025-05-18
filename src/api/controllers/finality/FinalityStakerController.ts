import { FinalityStakerService } from '../../../services/finality/FinalityStakerService';
import { Network } from '../../../types/finality';
import { Router, Request, Response } from 'express';
import { logger } from '../../../utils/logger';
import { formatSatoshis } from '../../../utils/util';

export class FinalityStakerController {
    private static instance: FinalityStakerController | null = null;
    private finalityStakerService: FinalityStakerService;

    private constructor() {
        this.finalityStakerService = FinalityStakerService.getInstance();
    }

    public static getInstance(): FinalityStakerController {
        if (!FinalityStakerController.instance) {
            FinalityStakerController.instance = new FinalityStakerController();
        }
        return FinalityStakerController.instance;
    }

    /**
     * Register staker routes on the provided router
     * @param router Express router
     */
    public registerRoutes(router: Router): void {
        // Get stakers for a finality provider
        router.get('/providers/:fpBtcPkHex/stakers', this.getStakersForProvider.bind(this));
        
        // Get all stakers
        router.get('/stakers', this.getAllStakers.bind(this));
    }

    /**
     * Get stakers for a finality provider
     */
    public async getStakersForProvider(req: Request, res: Response): Promise<Response> {
        try {
            const { fpBtcPkHex } = req.params;
            const network = req.network || Network.MAINNET;
            
            const stakers = await this.finalityStakerService.getStakersByFinalityProvider(fpBtcPkHex, network);
            
            // Calculate total stats
            const totalAmountSat = stakers.reduce((sum, staker) => sum + staker.total_amount_sat, 0);
            const totalDelegations = stakers.reduce((sum, staker) => sum + staker.delegation_count, 0);
            
            return res.json({
                stakers,
                stats: {
                    staker_count: stakers.length,
                    total_delegation_count: totalDelegations,
                    total_amount: formatSatoshis(totalAmountSat),
                    total_amount_sat: totalAmountSat
                }
            });
        } catch (error) {
            logger.error('Error getting stakers for finality provider:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get all stakers
     */
    public async getAllStakers(req: Request, res: Response): Promise<Response> {
        try {
            const network = req.network || Network.MAINNET;
            
            const stakers = await this.finalityStakerService.getAllStakers(network);
            
            // Calculate total stats
            const totalAmountSat = stakers.reduce((sum, staker) => sum + staker.total_amount_sat, 0);
            const totalDelegations = stakers.reduce((sum, staker) => sum + staker.delegation_count, 0);
            
            return res.json({
                stakers,
                stats: {
                    staker_count: stakers.length,
                    total_delegation_count: totalDelegations,
                    total_amount: formatSatoshis(totalAmountSat),
                    total_amount_sat: totalAmountSat
                }
            });
        } catch (error) {
            logger.error('Error getting all stakers:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
