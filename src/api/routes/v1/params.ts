import express from 'express';
import ParamsController from '../../controllers/params.controller';

const router = express.Router();

// Get all module parameters
router.get('/params', ParamsController.getAllParams);

// Get specific module parameters
router.get('/params/:module', ParamsController.getSpecificParams);

export default router;
