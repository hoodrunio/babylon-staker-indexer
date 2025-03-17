import express from 'express';
import { NewStakerController } from '../../controllers/btc-delegations/NewStakerController';

const router = express.Router();
const stakerController = NewStakerController.getInstance();

// Tüm staker'ları getir
router.get('/', (req, res) => stakerController.getAllStakers(req, res));

// Bir staker'ı ID'sine göre getir
router.get('/:stakerAddress', (req, res) => stakerController.getStakerByAddress(req, res));

// Bir staker'ın delegasyonlarını getir
router.get('/:stakerAddress/delegations', (req, res) => stakerController.getStakerDelegations(req, res));

// Bir staker'ın phase bazlı istatistiklerini getir
router.get('/:stakerAddress/phase-stats', (req, res) => stakerController.getStakerPhaseStats(req, res));

// Bir staker'ın unique finality provider'larını getir
router.get('/:stakerAddress/finality-providers', (req, res) => stakerController.getStakerUniqueFinalityProviders(req, res));

export default router; 