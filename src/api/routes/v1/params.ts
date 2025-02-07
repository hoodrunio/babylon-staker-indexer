import express from 'express';
import ParamsController from '../../controllers/params.controller';

const router = express.Router();

// Get all module parameters
router.get('/params', ParamsController.getAllParams);

export default router;
