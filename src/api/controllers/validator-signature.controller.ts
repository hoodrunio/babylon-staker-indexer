import { Request, Response } from 'express';
import { Network } from '../../types/finality';
import { ValidatorSignatureService } from '../../services/validator/ValidatorSignatureService';
import { logger } from '../../utils/logger';

export class ValidatorSignatureController {
    private static instance: ValidatorSignatureController | null = null;
    private validatorSignatureService: ValidatorSignatureService;

    private constructor() {
        this.validatorSignatureService = ValidatorSignatureService.getInstance();
    }

    public static getInstance(): ValidatorSignatureController {
        if (!ValidatorSignatureController.instance) {
            ValidatorSignatureController.instance = new ValidatorSignatureController();
        }
        return ValidatorSignatureController.instance;
    }

    public async getValidatorSignatures(req: Request, res: Response): Promise<void> {
        try {
            const { network } = req.query;
            const { validatorAddress, operatorAddress, minSignatureRate } = req.query;

            if (!network || !Object.values(Network).includes(network as Network)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid or missing network parameter'
                });
                return;
            }

            const signatures = await this.validatorSignatureService.getValidatorSignatures(
                validatorAddress as string,
                operatorAddress as string,
                minSignatureRate ? Number(minSignatureRate) : undefined
            );

            res.json({
                success: true,
                data: signatures
            });
        } catch (error) {
            logger.error('[ValidatorSignatureController] Error getting validator signatures:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    public async getValidatorSignaturesByConsensus(req: Request, res: Response): Promise<void> {
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

            const signature = await this.validatorSignatureService.getValidatorSignaturesByConsensusAddress(
                consensusAddress
            );

            if (!signature) {
                res.status(404).json({
                    success: false,
                    error: 'Validator signature not found'
                });
                return;
            }

            res.json({
                success: true,
                data: signature
            });
        } catch (error) {
            logger.error('[ValidatorSignatureController] Error getting validator signature by consensus:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    public async getValidatorMissedBlocks(req: Request, res: Response): Promise<void> {
        try {
            const { validatorAddress } = req.params;
            const { network, startHeight, endHeight } = req.query;

            if (!network || !Object.values(Network).includes(network as Network)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid or missing network parameter'
                });
                return;
            }

            const missedBlocks = await this.validatorSignatureService.getValidatorMissedBlocks(
                validatorAddress,
                startHeight ? Number(startHeight) : undefined,
                endHeight ? Number(endHeight) : undefined
            );

            res.json({
                success: true,
                data: missedBlocks
            });
        } catch (error) {
            logger.error('[ValidatorSignatureController] Error getting validator missed blocks:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    public async getValidatorSignaturesByValoper(req: Request, res: Response): Promise<void> {
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

            const signature = await this.validatorSignatureService.getValidatorSignaturesByValoperAddress(
                valoperAddress
            );

            if (!signature) {
                res.status(404).json({
                    success: false,
                    error: 'Validator signature not found'
                });
                return;
            }

            res.json({
                success: true,
                data: signature
            });
        } catch (error) {
            logger.error('[ValidatorSignatureController] Error getting validator signature by valoper:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }
} 