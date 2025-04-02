import { Router } from 'express';
import { CodeController, ContractController, VerificationController, HistoryController, SourceCodeController, upload } from '../../controllers/cosmwasm';

const router = Router();
const codeController = new CodeController();
const contractController = new ContractController();
const verificationController = new VerificationController();
const historyController = new HistoryController();
const sourceCodeController = new SourceCodeController();

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

// Smart and Raw Query routes
router.post('/contracts/:address/query', contractController.queryContract);
router.get('/contracts/:address/raw', contractController.rawQueryContract);

// Verification routes
router.post('/verify', upload.single('source'), verificationController.verifyContract);
router.post('/verify/github', verificationController.verifyContractFromGitHub);
router.get('/verifications/:id', verificationController.getVerificationStatus);
router.get('/codes/:code_id/verifications', verificationController.getVerificationsByCodeId);

// State and history routes
router.get('/state', historyController.getState);

// Source code routes
router.get('/codes/:codeId/source-code', sourceCodeController.getCodeSourceCode);
router.get('/contracts/:address/source-code', sourceCodeController.getContractSourceCode);
router.get('/codes/:codeId/source-code/file', sourceCodeController.getFileContent);

export default router;
