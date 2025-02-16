import { Request, Response } from 'express';
import { Network } from '../../types/finality';
import { ValidatorInfoService } from '../../services/validator/ValidatorInfoService';
import { logger } from '../../utils/logger';

export class ValidatorInfoController {
    private static instance: ValidatorInfoController | null = null;
    private validatorInfoService: ValidatorInfoService;

    private constructor() {
        this.validatorInfoService = ValidatorInfoService.getInstance();
    }

    public static getInstance(): ValidatorInfoController {
        if (!ValidatorInfoController.instance) {
            ValidatorInfoController.instance = new ValidatorInfoController();
        }
        return ValidatorInfoController.instance;
    }

    public async getValidatorByHexAddress(req: Request, res: Response): Promise<void> {
        try {
            const { hexAddress } = req.params;
            const { network } = req.query;

            if (!network || !Object.values(Network).includes(network as Network)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid or missing network parameter'
                });
                return;
            }

            const validator = await this.validatorInfoService.getValidatorByHexAddress(
                hexAddress,
                network as Network
            );

            if (!validator) {
                res.status(404).json({
                    success: false,
                    error: 'Validator not found'
                });
                return;
            }

            res.json({
                success: true,
                data: validator
            });
        } catch (error) {
            logger.error('[ValidatorInfoController] Error getting validator by hex address:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    public async getValidatorByConsensusAddress(req: Request, res: Response): Promise<void> {
        try {
            const { consensusAddress } = req.params;
            const { network } = req.query;

            if (!network || !Object.values(Network).includes(network as Network)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid or missing network parameter'
                });
                return;
            }

            const validator = await this.validatorInfoService.getValidatorByConsensusAddress(
                consensusAddress,
                network as Network
            );

            if (!validator) {
                res.status(404).json({
                    success: false,
                    error: 'Validator not found'
                });
                return;
            }

            res.json({
                success: true,
                data: validator
            });
        } catch (error) {
            logger.error('[ValidatorInfoController] Error getting validator by consensus address:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    public async getValidatorByValoperAddress(req: Request, res: Response): Promise<void> {
        try {
            const { valoperAddress } = req.params;
            const { network } = req.query;

            if (!network || !Object.values(Network).includes(network as Network)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid or missing network parameter'
                });
                return;
            }

            const validator = await this.validatorInfoService.getValidatorByValoperAddress(
                valoperAddress,
                network as Network
            );

            if (!validator) {
                res.status(404).json({
                    success: false,
                    error: 'Validator not found'
                });
                return;
            }

            res.json({
                success: true,
                data: validator
            });
        } catch (error) {
            logger.error('[ValidatorInfoController] Error getting validator by valoper address:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    public async getAllValidators(req: Request, res: Response): Promise<void> {
        try {
            const { network, inactive, page, limit } = req.query;

            if (!network || !Object.values(Network).includes(network as Network)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid or missing network parameter'
                });
                return;
            }

            const result = await this.validatorInfoService.getAllValidators(
                network as Network,
                inactive === 'true',
                page ? parseInt(page as string) : undefined,
                limit ? parseInt(limit as string) : undefined
            );

            res.json({
                success: true,
                data: result.validators,
                pagination: {
                    total: result.total,
                    page: page ? parseInt(page as string) : 1,
                    limit: limit ? Math.min(parseInt(limit as string), 100) : 100,
                    pages: Math.ceil(result.total / (limit ? Math.min(parseInt(limit as string), 100) : 100))
                }
            });
        } catch (error) {
            logger.error('[ValidatorInfoController] Error getting all validators:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }
} 