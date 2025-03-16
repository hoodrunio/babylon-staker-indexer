import express from 'express';
import { ValidatorSignatureController } from '../../controllers/validator-signature.controller';

const router = express.Router();
const controller = ValidatorSignatureController.getInstance();

router.get('/', controller.getValidatorSignatures.bind(controller));

router.get('/by-consensus/:consensusAddress', controller.getValidatorSignaturesByConsensus.bind(controller));

router.get('/:validatorAddress/missed-blocks', controller.getValidatorMissedBlocks.bind(controller));

router.get('/:valoperAddress', controller.getValidatorSignaturesByValoper.bind(controller));

export default router; 