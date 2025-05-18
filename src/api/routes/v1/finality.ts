import { Router } from 'express';
import { FinalitySignatureController } from '../../controllers/finality/FinalitySignatureController';
import { FinalityProviderController } from '../../controllers/finality/FinalityProviderController';
import { FinalityDelegationController } from '../../controllers/finality/FinalityDelegationController';
import { FinalityStakerController } from '../../controllers/finality/FinalityStakerController';
import { FinalityEpochController } from '../../controllers/finality/FinalityEpochController';
import { StakeholderRewardsController } from '../../controllers/finality/StakeholderRewardsController';

const router = Router();

// Initialize all controllers
const finalitySignatureController = FinalitySignatureController.getInstance();
const finalityProviderController = FinalityProviderController.getInstance();
const finalityDelegationController = FinalityDelegationController.getInstance();
const finalityStakerController = FinalityStakerController.getInstance();
const finalityEpochController = FinalityEpochController.getInstance();
const stakeholderRewardsController = StakeholderRewardsController.getInstance();

// Register all controller routes
finalitySignatureController.registerRoutes(router);
finalityProviderController.registerRoutes(router);
finalityDelegationController.registerRoutes(router);
finalityStakerController.registerRoutes(router);
finalityEpochController.registerRoutes(router);
stakeholderRewardsController.registerRoutes(router);

export default router;