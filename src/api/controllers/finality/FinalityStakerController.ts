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
            const { 
                page = '1', 
                limit = '100' 
            } = req.query;
            const network = req.network || Network.MAINNET;
            
            // Parse pagination parameters
            const pageNum = parseInt(page as string, 10);
            const limitNum = parseInt(limit as string, 10);

            // Validate pagination parameters
            if (isNaN(pageNum) || pageNum < 1) {
                return res.status(400).json({
                    error: 'Invalid page parameter. Must be a positive number'
                });
            }

            if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
                return res.status(400).json({
                    error: 'Invalid limit parameter. Must be between 1 and 100'
                });
            }
            
            // Get all stakers for the provider
            const allStakers = await this.finalityStakerService.getStakersByFinalityProvider(fpBtcPkHex, network);
            
            // Calculate total stats
            const totalAmountSat = allStakers.reduce((sum, staker) => sum + staker.total_amount_sat, 0);
            const totalDelegations = allStakers.reduce((sum, staker) => sum + staker.delegation_count, 0);
            
            // Apply pagination
            const start = (pageNum - 1) * limitNum;
            const end = start + limitNum;
            const paginatedStakers = allStakers.slice(start, end);
            
            // Calculate pagination info
            const totalCount = allStakers.length;
            const totalPages = Math.ceil(totalCount / limitNum);
            const hasNext = pageNum < totalPages;
            const hasPrevious = pageNum > 1;
            
            return res.json({
                stakers: paginatedStakers,
                stats: {
                    staker_count: totalCount,
                    total_delegation_count: totalDelegations,
                    total_amount: formatSatoshis(totalAmountSat),
                    total_amount_sat: totalAmountSat
                },
                pagination: {
                    total_count: totalCount,
                    total_pages: totalPages,
                    current_page: pageNum,
                    has_next: hasNext,
                    has_previous: hasPrevious,
                    next_page: hasNext ? pageNum + 1 : null,
                    previous_page: hasPrevious ? pageNum - 1 : null
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
            const { 
                page = '1', 
                limit = '100' 
            } = req.query;
            const network = req.network || Network.MAINNET;
            
            // Parse pagination parameters
            const pageNum = parseInt(page as string, 10);
            const limitNum = parseInt(limit as string, 10);

            // Validate pagination parameters
            if (isNaN(pageNum) || pageNum < 1) {
                return res.status(400).json({
                    error: 'Invalid page parameter. Must be a positive number'
                });
            }

            if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
                return res.status(400).json({
                    error: 'Invalid limit parameter. Must be between 1 and 100'
                });
            }
            
            // Get all stakers
            const allStakers = await this.finalityStakerService.getAllStakers(network);
            
            // Calculate total stats
            const totalAmountSat = allStakers.reduce((sum, staker) => sum + staker.total_amount_sat, 0);
            const totalDelegations = allStakers.reduce((sum, staker) => sum + staker.delegation_count, 0);
            
            // Apply pagination
            const start = (pageNum - 1) * limitNum;
            const end = start + limitNum;
            const paginatedStakers = allStakers.slice(start, end);
            
            // Calculate pagination info
            const totalCount = allStakers.length;
            const totalPages = Math.ceil(totalCount / limitNum);
            const hasNext = pageNum < totalPages;
            const hasPrevious = pageNum > 1;
            
            return res.json({
                stakers: paginatedStakers,
                stats: {
                    staker_count: totalCount,
                    total_delegation_count: totalDelegations,
                    total_amount: formatSatoshis(totalAmountSat),
                    total_amount_sat: totalAmountSat
                },
                pagination: {
                    total_count: totalCount,
                    total_pages: totalPages,
                    current_page: pageNum,
                    has_next: hasNext,
                    has_previous: hasPrevious,
                    next_page: hasNext ? pageNum + 1 : null,
                    previous_page: hasPrevious ? pageNum - 1 : null
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
