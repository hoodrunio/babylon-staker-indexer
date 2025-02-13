import express from 'express';
import { ValidatorInfoController } from '../../controllers/validator-info.controller';

const router = express.Router();
const controller = ValidatorInfoController.getInstance();

router.get('/all', controller.getAllValidators.bind(controller));

router.get('/by-hex/:hexAddress', controller.getValidatorByHexAddress.bind(controller));

router.get('/by-consensus/:consensusAddress', controller.getValidatorByConsensusAddress.bind(controller));

router.get('/by-valoper/:valoperAddress', controller.getValidatorByValoperAddress.bind(controller));

export default router; 