import { FinalityDelegationService, SortField, SortOrder } from '../../../services/finality/FinalityDelegationService';
import { Network } from '../../../types/finality';
import { Router, Request, Response } from 'express';
import { logger } from '../../../utils/logger';
import { BTCDelegationStatus } from '../../../types/finality/btcstaking';

export class FinalityDelegationController {
    private static instance: FinalityDelegationController | null = null;
    private finalityDelegationService: FinalityDelegationService;

    private constructor() {
        this.finalityDelegationService = FinalityDelegationService.getInstance();
    }

    public static getInstance(): FinalityDelegationController {
        if (!FinalityDelegationController.instance) {
            FinalityDelegationController.instance = new FinalityDelegationController();
        }
        return FinalityDelegationController.instance;
    }

    /**
     * Register delegation routes on the provided router
     * @param router Express router
     */
    public registerRoutes(router: Router): void {
        // Get delegations for a finality provider
        router.get('/providers/:fpBtcPkHex/delegations', this.getDelegationsForProvider.bind(this));
    }

    /**
     * Get delegations for a finality provider
     */
    public async getDelegationsForProvider(req: Request, res: Response): Promise<Response> {
        try {
            const { fpBtcPkHex } = req.params;
            const { 
                page = '1', 
                limit = '10', 
                status,
                sortBy,
                sortOrder,
                minAmount,
                maxAmount
            } = req.query;
            
            const network = req.network || Network.MAINNET;
            
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

            // Validate status if provided
            if (status && !Object.values(BTCDelegationStatus).includes(status as BTCDelegationStatus)) {
                return res.status(400).json({
                    error: `Invalid status. Must be one of: ${Object.values(BTCDelegationStatus).join(', ')}`
                });
            }

            // Validate sort parameters
            const validSortFields = ['amount', 'startHeight', 'createdAt'];
            if (sortBy && !validSortFields.includes(sortBy as string)) {
                return res.status(400).json({
                    error: `Invalid sortBy parameter. Must be one of: ${validSortFields.join(', ')}`
                });
            }

            if (sortOrder && !['asc', 'desc'].includes(sortOrder as string)) {
                return res.status(400).json({
                    error: 'Invalid sortOrder parameter. Must be one of: asc, desc'
                });
            }

            // Parse numeric filters
            let minAmountNum: number | undefined;
            let maxAmountNum: number | undefined;

            if (minAmount) {
                minAmountNum = parseInt(minAmount as string, 10);
                if (isNaN(minAmountNum) || minAmountNum < 0) {
                    return res.status(400).json({
                        error: 'Invalid minAmount parameter. Must be a non-negative number'
                    });
                }
            }

            if (maxAmount) {
                maxAmountNum = parseInt(maxAmount as string, 10);
                if (isNaN(maxAmountNum) || maxAmountNum < 0) {
                    return res.status(400).json({
                        error: 'Invalid maxAmount parameter. Must be a non-negative number'
                    });
                }
            }

            // Prepare query options
            const options = {
                status: status as BTCDelegationStatus,
                sortBy: sortBy as SortField,
                sortOrder: sortOrder as SortOrder,
                minAmount: minAmountNum,
                maxAmount: maxAmountNum
            };

            // Get delegations with pagination
            const result = await this.finalityDelegationService.getFinalityProviderDelegations(
                fpBtcPkHex,
                network,
                pageNum,
                limitNum,
                options
            );
            
            return res.json(result);
        } catch (error) {
            logger.error('Error getting delegations for finality provider:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
