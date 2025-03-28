import { Router } from 'express';
import { CodeController, ContractController, VerificationController, upload } from '../../controllers/cosmwasm';

const router = Router();
const codeController = new CodeController();
const contractController = new ContractController();
const verificationController = new VerificationController();

// Code routes
router.get('/codes', codeController.getCodes);
router.get('/codes/:id', codeController.getCodeById);
router.get('/codes/:id/contracts', codeController.getContractsByCodeId);

// Contract routes
router.get('/contracts', contractController.getContracts);
router.get('/contracts/:address', contractController.getContractByAddress);
router.get('/contracts/:address/methods', contractController.getContractMethods);
router.get('/contracts/creator/:creator', contractController.getContractsByCreator);

// Verification routes
router.post('/verify', upload.single('source'), verificationController.verifyContract);
router.post('/verify/github', verificationController.verifyContractFromGitHub);
router.get('/verifications/:id', verificationController.getVerificationStatus);
router.get('/codes/:code_id/verifications', verificationController.getVerificationsByCodeId);

export default router;
