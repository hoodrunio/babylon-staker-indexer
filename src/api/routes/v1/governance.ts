import { Router } from 'express';
import { 
    getAllProposals, 
    getProposalById, 
    getProposalVotes, 
    getProposalStats 
} from '../../controllers/governance/governance.controller';

const router = Router();

// Get all proposals
router.get('/proposals', getAllProposals);

// Get proposal by ID
router.get('/proposals/:id', getProposalById);

// Get votes for a proposal
router.get('/proposals/:id/votes', getProposalVotes);

// Get voting statistics for a proposal
router.get('/proposals/:id/stats', getProposalStats);

export default router; 