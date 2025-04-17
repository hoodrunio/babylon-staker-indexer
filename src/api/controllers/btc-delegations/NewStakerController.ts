import { Request, Response } from 'express';
import { NewStakerService } from '../../../services/btc-delegations/NewStakerService';
import { logger } from '../../../utils/logger';

export class NewStakerController {
    private static instance: NewStakerController;
    private stakerService: NewStakerService;

    private constructor() {
        this.stakerService = NewStakerService.getInstance();
    }

    public static getInstance(): NewStakerController {
        if (!NewStakerController.instance) {
            NewStakerController.instance = new NewStakerController();
        }
        return NewStakerController.instance;
    }

    public async getAllStakers(req: Request, res: Response): Promise<void> {
        try {
            let limit = parseInt(req.query.limit as string) || 10;
            limit = Math.min(limit, 100);
            const page = parseInt(req.query.page as string) || 1;
            const skip = (page - 1) * limit;
            const sortField = (req.query.sort_by as string) || 'totalStakedSat';
            const sortOrder = (req.query.order as string) || 'desc';
            const detailed = req.query.detailed === 'true';

            // Get total staked amount and unique providers count
            const [totalStakedAmount, uniqueProvidersCount, averageStakeAmount] = await Promise.all([
                this.stakerService.getTotalStakedAmount(),
                this.stakerService.getUniqueProvidersCount(),
                this.stakerService.getAverageStakeAmount()
            ]);

            if (detailed) {
                const [stakers, total] = await Promise.all([
                    this.stakerService.getAllStakers(limit, skip, sortField, sortOrder),
                    this.stakerService.getStakersCount()
                ]);

                res.json({
                    data: stakers,
                    meta: {
                        pagination: {
                            total,
                            page,
                            limit,
                            pages: Math.ceil(total / limit)
                        },
                        stats: {
                            totalStakedAmount,
                            uniqueProvidersCount,
                            averageStakeAmount
                        }
                    }
                });
            } else {
                const [stakers, total] = await Promise.all([
                    this.stakerService.getStakersSummary(limit, skip, sortField, sortOrder),
                    this.stakerService.getStakersCount()
                ]);

                res.json({
                    data: stakers,
                    meta: {
                        pagination: {
                            total,
                            page,
                            limit,
                            pages: Math.ceil(total / limit)
                        },
                        stats: {
                            totalStakedAmount,
                            uniqueProvidersCount,
                            averageStakeAmount
                        }
                    }
                });
            }
        } catch (error) {
            logger.error('Error fetching stakers:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public async getStakerByAddress(req: Request, res: Response): Promise<void> {
        try {
            const { stakerAddress } = req.params;
            const staker = await this.stakerService.getStakerByAddress(stakerAddress);

            if (!staker) {
                res.status(404).json({ 
                    error: 'Staker not found', 
                    message: 'No staker found with the provided Babylon or BTC address'
                });
                return;
            }

            res.json({ data: staker });
        } catch (error) {
            logger.error('Error fetching staker:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public async getStakerDelegations(req: Request, res: Response): Promise<void> {
        try {
            const { stakerAddress } = req.params;
            let limit = parseInt(req.query.limit as string) || 10;
            limit = Math.min(limit, 100);
            const page = parseInt(req.query.page as string) || 1;
            const skip = (page - 1) * limit;
            const sortField = (req.query.sort_by as string) || 'stakingTime';
            const sortOrder = (req.query.order as string) || 'desc';

            const staker = await this.stakerService.getStakerByAddress(stakerAddress);

            if (!staker) {
                res.status(404).json({ 
                    error: 'Staker not found', 
                    message: 'No staker found with the provided Babylon or BTC address' 
                });
                return;
            }

            const delegations = await this.stakerService.getStakerDelegations(
                stakerAddress, 
                limit, 
                skip, 
                sortField, 
                sortOrder
            );

            res.json({
                data: delegations,
                meta: {
                    pagination: {
                        page,
                        limit,
                        total: staker.totalDelegationsCount,
                        pages: Math.ceil(staker.totalDelegationsCount / limit)
                    },
                    staker: {
                        address: staker.stakerAddress,
                        btcAddress: staker.stakerBtcAddress,
                        totalDelegationsCount: staker.totalDelegationsCount,
                        activeDelegationsCount: staker.activeDelegationsCount,
                        totalStakedSat: staker.totalStakedSat
                    }
                }
            });
        } catch (error) {
            logger.error('Error fetching staker delegations:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public async getStakerPhaseStats(req: Request, res: Response): Promise<void> {
        try {
            const { stakerAddress } = req.params;
            const phase = req.query.phase ? parseInt(req.query.phase as string) : undefined;

            // First check if staker exists
            const staker = await this.stakerService.getStakerByAddress(stakerAddress);
            if (!staker) {
                res.status(404).json({ 
                    error: 'Staker not found', 
                    message: 'No staker found with the provided Babylon or BTC address' 
                });
                return;
            }

            const phaseStats = await this.stakerService.getStakerPhaseStats(stakerAddress, phase);

            res.json({
                data: phaseStats
            });
        } catch (error) {
            logger.error('Error fetching staker phase stats:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public async getStakerUniqueFinalityProviders(req: Request, res: Response): Promise<void> {
        try {
            const { stakerAddress } = req.params;

            // First check if staker exists
            const staker = await this.stakerService.getStakerByAddress(stakerAddress);
            if (!staker) {
                res.status(404).json({ 
                    error: 'Staker not found', 
                    message: 'No staker found with the provided Babylon or BTC address' 
                });
                return;
            }

            const finalityProviders = await this.stakerService.getStakerUniqueFinalityProviders(stakerAddress);

            res.json({
                data: finalityProviders
            });
        } catch (error) {
            logger.error('Error fetching staker finality providers:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 