import { Router } from 'express';
import reconciliationController from '../controllers/reconciliationController.js';

const router = Router();

// Asynchronous reconciliation run trigger
router.post('/reconcile', reconciliationController.triggerReconciliation);

// Retrieve flat matching reports list
router.get('/report/:runId', reconciliationController.getReconciliationReport);

// Retrieve matching summaries statistics
router.get('/report/:runId/summary', reconciliationController.getReconciliationSummary);

// Retrieve unmatched user & exchange records list
router.get('/report/:runId/unmatched', reconciliationController.getUnmatchedReports);

// Export CSV report file download
router.get('/report/:runId/export', reconciliationController.exportReportCsv);

export default router;
