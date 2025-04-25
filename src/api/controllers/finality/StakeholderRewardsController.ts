import { StakeholderRewardsService } from '../../../services/finality/StakeholderRewardsService';
import { Network } from '../../../types/finality';
import { Router } from 'express';
import { logger } from '../../../utils/logger';
import { FinalityProviderService } from '../../../services/finality/FinalityProviderService';

export class StakeholderRewardsController {
    private static instance: StakeholderRewardsController | null = null;
    private stakeholderRewardsService: StakeholderRewardsService;
    private finalityProviderService: FinalityProviderService;

    private constructor() {
        this.stakeholderRewardsService = StakeholderRewardsService.getInstance();
        this.finalityProviderService = FinalityProviderService.getInstance();
    }

    public static getInstance(): StakeholderRewardsController {
        if (!StakeholderRewardsController.instance) {
            StakeholderRewardsController.instance = new StakeholderRewardsController();
        }
        return StakeholderRewardsController.instance;
    }

    /**
     * Register rewards routes on the provided router
     * @param router Express router
     */
    public registerRoutes(router: Router): void {
        // Get rewards for any stakeholder (finality provider or BTC staker) by Babylon address
        router.get('/rewards/address/:address', this.getRewardsByAddress.bind(this));
        
        // Get rewards for a finality provider by BTC public key
        router.get('/rewards/btc-pk/:btcPkHex', this.getRewardsByBtcPk.bind(this));
        
        // Get rewards summary for all finality providers
        router.get('/rewards/summary', this.getRewardsSummary.bind(this));
    }

    /**
     * Get rewards by Babylon address (works for both finality providers and BTC stakers)
     */
    public async getRewardsByAddress(req: any, res: any) {
        try {
            const { address } = req.params;
            const network = req.network || Network.MAINNET;

            // Validate address format
            if (!this.isValidBabylonAddress(address)) {
                return res.status(400).json({
                    error: 'Invalid address format',
                    message: 'Address must be a valid Babylon address (bbn1...)'
                });
            }

            // Get raw rewards from the blockchain
            const rawRewards = await this.stakeholderRewardsService.getStakeholderRewards(address, network);
            
            // Format rewards for API response
            const formattedRewards = this.stakeholderRewardsService.formatRewards(rawRewards);
            
            return res.json({
                address,
                rewards: formattedRewards
            });
        } catch (error) {
            logger.error('Error getting rewards by address:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get finality provider rewards by BTC public key
     */
    public async getRewardsByBtcPk(req: any, res: any) {
        try {
            const { btcPkHex } = req.params;
            const network = req.network || Network.MAINNET;

            // Get provider details to find its Babylon address
            const provider = await this.finalityProviderService.getFinalityProvider(btcPkHex, network);
            
            if (!provider || !provider.addr) {
                return res.status(404).json({
                    error: 'Provider not found',
                    message: 'Finality provider not found or no Babylon address associated'
                });
            }

            // Get raw rewards from the blockchain
            const rawRewards = await this.stakeholderRewardsService.getStakeholderRewards(
                provider.addr, 
                network
            );
            
            // Format rewards for API response
            const formattedRewards = this.stakeholderRewardsService.formatRewards(rawRewards);
            
            return res.json({
                btc_pk: btcPkHex,
                babylon_address: provider.addr,
                rewards: formattedRewards
            });
        } catch (error) {
            logger.error('Error getting rewards by BTC PK:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get rewards summary for all active finality providers
     */
    public async getRewardsSummary(req: any, res: any) {
        try {
            // Make sure we're explicitly passing a valid network parameter
            const network = req.network === 'testnet' ? Network.TESTNET : Network.MAINNET;
            
            // logger.info(`Getting rewards summary for network: ${network}`);
            
            // Get rewards summary for all providers
            const result = await this.stakeholderRewardsService.getAllFinalityProviderRewardsSummary(network);
            
            // logger.info(`Got rewards summary with ${result.rewards ? result.rewards.length : 0} providers`);
            
            // Return the formatted response
            return res.json({
                count: result.rewards ? result.rewards.length : 0,
                rewards: result.rewards || []
            });
        } catch (error) {
            logger.error('Error getting rewards summary:', error);
            return res.status(500).json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Validate if the given string is a valid Babylon address
     * @param address Address to validate
     * @returns True if valid Babylon address
     */
    private isValidBabylonAddress(address: string): boolean {
        // Basic validation for Babylon address format (bbn1...)
        return typeof address === 'string' && address.startsWith('bbn1') && address.length >= 39;
    }
}
