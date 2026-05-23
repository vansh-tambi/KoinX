import { Router } from 'express';
import reconciliationController from '../controllers/reconciliationController.js';

const router = Router();

// Endpoint to trigger matching runs
router.post('/trigger', reconciliationController.triggerReconciliation);

// Endpoint to retrieve reports
router.get('/reports/:reportId', reconciliationController.getReconciliationReport);

export default router;
