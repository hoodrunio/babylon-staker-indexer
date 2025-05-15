import { Router } from 'express';
import { StakeholderRewardsController } from '../../controllers/finality/StakeholderRewardsController';

const router = Router();

// Initialize the stakeholder rewards controller and register dedicated routes
const stakeholderRewardsController = StakeholderRewardsController.getInstance();

// Get rewards for any stakeholder (finality provider or BTC staker) by Babylon address
router.get('/address/:address', stakeholderRewardsController.getRewardsByAddress.bind(stakeholderRewardsController));

// Get rewards for a finality provider by BTC public key
router.get('/finality-provider/btc-pk/:btcPkHex', stakeholderRewardsController.getRewardsByBtcPk.bind(stakeholderRewardsController));

// Get rewards summary for all finality providers
router.get('/finality-provider/summary', stakeholderRewardsController.getRewardsSummary.bind(stakeholderRewardsController));

export default router;
