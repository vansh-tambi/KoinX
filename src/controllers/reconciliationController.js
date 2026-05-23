import reconciliationRunRepository from '../repositories/reconciliationRunRepository.js';
import reconciliationReportRepository from '../repositories/reconciliationReportRepository.js';
import { queueReconciliationJob } from '../jobs/reconciliationQueue.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Triggers an asynchronous reconciliation process by queuing it in BullMQ.
 * Returns standard { runId, status: "queued" } payload.
 */
export const triggerReconciliation = async (req, res, next) => {
  try {
    const runId = uuidv4();
    
    // Create the reconciliation run record in DB
    const run = await reconciliationRunRepository.create({
      runId,
      status: 'PENDING',
      config: req.body.config || {},
      startedAt: new Date(),
      summary: {
        totalTransactions: 0,
        matchedCount: 0,
        conflictingCount: 0,
        unmatchedUserCount: 0,
        unmatchedExchangeCount: 0
      }
    });

    // Enqueue job to BullMQ
    await queueReconciliationJob(run.runId);

    // Return the specified async payload
    res.status(202).json({
      runId: run.runId,
      status: 'queued',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Retrieve a reconciliation report.
 */
export const getReconciliationReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const report = await reconciliationReportRepository.findById(reportId);
    
    if (!report) {
      return res.status(404).json({
        success: false,
        error: { message: `Reconciliation report not found with ID: ${reportId}` }
      });
    }

    res.json({
      success: true,
      data: report,
    });
  } catch (err) {
    next(err);
  }
};

export default { triggerReconciliation, getReconciliationReport };
