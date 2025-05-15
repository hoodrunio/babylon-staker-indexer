import express from 'express';
import { NewStakerController } from '../../controllers/btc-delegations/NewStakerController';

const router = express.Router();
const stakerController = NewStakerController.getInstance();

// Get all stakers
router.get('/', (req, res) => stakerController.getAllStakers(req, res));

// Get a staker by Babylon or BTC address
router.get('/:stakerAddress', (req, res) => stakerController.getStakerByAddress(req, res));

// Get delegations of a staker (Babylon or BTC address can be used)
router.get('/:stakerAddress/delegations', (req, res) => stakerController.getStakerDelegations(req, res));

// Get phase-based statistics of a staker (Babylon or BTC address can be used)
router.get('/:stakerAddress/phase-stats', (req, res) => stakerController.getStakerPhaseStats(req, res));

// Get unique finality providers of a staker (Babylon or BTC address can be used)
router.get('/:stakerAddress/finality-providers', (req, res) => stakerController.getStakerUniqueFinalityProviders(req, res));

export default router;