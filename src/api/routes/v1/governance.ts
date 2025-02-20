import { Router } from 'express';
import { 
    getAllProposals, 
    getProposalById, 
    getProposalVotes, 
    getProposalStats 
} from '../../controllers/governance/governance.controller';
import { networkSelector } from '../../middleware/network-selector';

const router = Router();

// Get all proposals
router.get('/proposals', networkSelector, getAllProposals);

// Get proposal by ID
router.get('/proposals/:id', networkSelector, getProposalById);

// Get votes for a proposal
router.get('/proposals/:id/votes', networkSelector, getProposalVotes);

// Get voting statistics for a proposal
router.get('/proposals/:id/stats', networkSelector, getProposalStats);

export default router; 