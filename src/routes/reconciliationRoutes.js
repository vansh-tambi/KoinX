import { Router } from 'express';
import reconciliationController from '../controllers/reconciliationController.js';

const router = Router();

// Async reconciliation workflow endpoint
router.post('/reconcile', reconciliationController.triggerReconciliation);

// Backward compatible trigger route
router.post('/trigger', reconciliationController.triggerReconciliation);

// Endpoint to retrieve reports
router.get('/reports/:reportId', reconciliationController.getReconciliationReport);

export default router;
