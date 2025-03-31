import { Router } from 'express';
import { CodeController, ContractController, VerificationController, HistoryController, upload } from '../../controllers/cosmwasm';

const router = Router();
const codeController = new CodeController();
const contractController = new ContractController();
const verificationController = new VerificationController();
const historyController = new HistoryController();

// Code routes
router.get('/codes', codeController.getCodes);
router.get('/codes/:id', codeController.getCodeById);
router.get('/codes/:id/contracts', codeController.getContractsByCodeId);
router.get('/codes/:id/transactions', historyController.getCodeTransactions);

// Contract routes
router.get('/contracts', contractController.getContracts);
router.get('/contracts/:address', contractController.getContractByAddress);
router.get('/contracts/:address/methods', contractController.getContractMethods);
router.get('/contracts/:address/suggestions/queries', contractController.getSuggestedQueries);
router.get('/contracts/creator/:creator', contractController.getContractsByCreator);
router.get('/contracts/:address/transactions', historyController.getContractTransactions);
router.get('/contracts/:address/state', historyController.getContractState);
router.get('/contracts/:address/history', historyController.getContractHistory);

// Verification routes
router.post('/verify', upload.single('source'), verificationController.verifyContract);
router.post('/verify/github', verificationController.verifyContractFromGitHub);
router.get('/verifications/:id', verificationController.getVerificationStatus);
router.get('/codes/:code_id/verifications', verificationController.getVerificationsByCodeId);

// State and history routes
router.get('/state', historyController.getState);

export default router;
