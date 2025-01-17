import { Request, Response } from 'express';
import { BTCDelegationService } from '../../../services/btc-delegations/BTCDelegationService';
import { BTCDelegationStatus } from '../../../types/finality/btcstaking';
import { Network } from '../../middleware/network-selector';

export class BTCDelegationController {
    private static instance: BTCDelegationController | null = null;
    private delegationService: BTCDelegationService;

    private constructor() {
        this.delegationService = BTCDelegationService.getInstance();
    }

    public static getInstance(): BTCDelegationController {
        if (!BTCDelegationController.instance) {
            BTCDelegationController.instance = new BTCDelegationController();
        }
        return BTCDelegationController.instance;
    }

    public async getDelegationsByStatus(req: Request, res: Response): Promise<void> {
        try {
            const status = (req.query.status as string || 'ACTIVE').toUpperCase() as BTCDelegationStatus;
            const network = req.network || Network.MAINNET;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            if (!Object.values(BTCDelegationStatus).includes(status)) {
                res.status(400).json({
                    error: `Invalid status. Must be one of: ${Object.values(BTCDelegationStatus).join(', ')}`
                });
                return;
            }

            const result = await this.delegationService.getDelegationsByStatus(
                status,
                network,
                page,
                limit
            );

            res.json(result);
        } catch (error) {
            console.error('Error in getDelegationsByStatus:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    public async getDelegationByTxHash(req: Request, res: Response): Promise<void> {
        try {
            const { txHash } = req.params;
            const network = req.network || Network.MAINNET;

            if (!txHash) {
                res.status(400).json({ error: 'Transaction hash is required' });
                return;
            }

            const delegation = await this.delegationService.getDelegationByTxHash(txHash, network);

            if (!delegation) {
                res.status(404).json({ error: 'Delegation not found' });
                return;
            }

            res.json({ delegation });
        } catch (error) {
            console.error('Error in getDelegationByTxHash:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
} 